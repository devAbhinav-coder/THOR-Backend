import InventoryEventOutbox, {
  InventoryOutboxEventType,
} from "../../models/InventoryEventOutbox";
import { scheduleInventorySummaryInvalidation } from "./inventoryCacheService";
import { invalidatePdpForProductId } from "../productCacheService";
import logger from "../../types/utils/logger";
import { getRequestContext } from "../../types/utils/requestContext";
import { recordInventoryMetric } from "./inventoryMetricsService";
import {
  logOutboxDeadLetter,
  nextOutboxStatusAfterFailure,
} from "../outboxDeadLetter";

const MAX_ATTEMPTS = 6;
const BASE_BACKOFF_MS = 1500;

function nextBackoffMs(attempts: number): number {
  return Math.min(BASE_BACKOFF_MS * 2 ** attempts, 30 * 60 * 1000);
}

export async function enqueueInventorySideEffect(
  eventType: InventoryOutboxEventType,
  payload: Record<string, unknown>,
  dedupeKey: string,
): Promise<void> {
  try {
    const doc = await InventoryEventOutbox.findOneAndUpdate(
      { dedupeKey },
      {
        $setOnInsert: {
          dedupeKey,
          eventType,
          payload,
          status: "pending",
          attempts: 0,
          nextAttemptAt: new Date(),
        },
      },
      { upsert: true, new: true },
    ).lean();

    if (doc?.status === "completed") return;
    scheduleDispatchInventoryOutbox(String(doc?._id ?? ""));
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "outbox write failed";
    const ctx = getRequestContext();
    logger.error({
      msg: "inventory_outbox_persist_failed",
      dedupeKey,
      requestId: ctx?.requestId,
      error: message,
    });
    recordInventoryMetric("inventory.outbox.dispatch_failure", {
      phase: "persist",
    });
  }
}

function scheduleDispatchInventoryOutbox(outboxId: string): void {
  if (!outboxId) return;
  dispatchInventoryOutboxById(outboxId).catch((err: Error) => {
    logger.warn({
      msg: "inventory_outbox_immediate_dispatch_failed",
      outboxId,
      error: err.message,
    });
  });
}

async function executeOutboxEvent(
  eventType: InventoryOutboxEventType,
  payload: Record<string, unknown>,
): Promise<void> {
  if (eventType === "invalidate_summary") {
    scheduleInventorySummaryInvalidation();
    return;
  }
  if (eventType === "invalidate_pdp") {
    const productId = String(payload.productId ?? "");
    if (productId) await invalidatePdpForProductId(productId);
  }
}

export async function dispatchInventoryOutboxById(
  outboxId: string,
): Promise<boolean> {
  const claimed = await InventoryEventOutbox.findOneAndUpdate(
    {
      _id: outboxId,
      status: { $in: ["pending", "failed"] },
      nextAttemptAt: { $lte: new Date() },
    },
    { $set: { status: "processing" }, $inc: { attempts: 1 } },
    { new: true },
  );

  if (!claimed) return false;

  try {
    await executeOutboxEvent(
      claimed.eventType,
      claimed.payload as Record<string, unknown>,
    );
    await InventoryEventOutbox.updateOne(
      { _id: claimed._id },
      {
        $set: {
          status: "completed",
          processedAt: new Date(),
          lastError: undefined,
        },
      },
    );
    return true;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "dispatch failed";
    const attempts = claimed.attempts;
    const terminal = attempts >= MAX_ATTEMPTS;
    const nextStatus = nextOutboxStatusAfterFailure(attempts, MAX_ATTEMPTS);
    await InventoryEventOutbox.updateOne(
      { _id: claimed._id },
      {
        $set: {
          status: nextStatus,
          lastError: message.slice(0, 500),
          nextAttemptAt: new Date(Date.now() + nextBackoffMs(attempts)),
        },
      },
    );
    recordInventoryMetric("inventory.outbox.dispatch_failure", {
      terminal,
      attempts,
    });
    if (terminal) {
      logOutboxDeadLetter(
        "inventory",
        String(claimed._id),
        claimed.dedupeKey,
        attempts,
        message,
      );
    }
    return false;
  }
}

export async function processPendingInventoryOutboxBatch(
  limit = 25,
): Promise<number> {
  const pending = await InventoryEventOutbox.find({
    status: { $in: ["pending", "failed"] },
    nextAttemptAt: { $lte: new Date() },
    attempts: { $lt: MAX_ATTEMPTS },
  })
    .sort({ nextAttemptAt: 1 })
    .limit(limit)
    .select("_id")
    .lean()
    .maxTimeMS(5000);

  let dispatched = 0;
  for (const row of pending) {
    const ok = await dispatchInventoryOutboxById(String(row._id));
    if (ok) dispatched += 1;
  }
  return dispatched;
}
