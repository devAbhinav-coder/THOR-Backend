import CartEventOutbox, {
  CartOutboxEventType,
} from "../../models/CartEventOutbox";
import logger from "../../types/utils/logger";
import { getRequestContext } from "../../types/utils/requestContext";
import { recordCartMetric } from "./cartMetricsService";
import {
  logOutboxDeadLetter,
  nextOutboxStatusAfterFailure,
} from "../outboxDeadLetter";

const MAX_ATTEMPTS = 6;
const BASE_BACKOFF_MS = 1500;

function nextBackoffMs(attempts: number): number {
  return Math.min(BASE_BACKOFF_MS * 2 ** attempts, 30 * 60 * 1000);
}

export async function enqueueCartOutboxEvent(
  eventType: CartOutboxEventType,
  payload: Record<string, unknown>,
  dedupeKey: string,
): Promise<void> {
  try {
    const doc = await CartEventOutbox.findOneAndUpdate(
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
    scheduleDispatchCartOutbox(String(doc?._id ?? ""));
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "outbox write failed";
    const ctx = getRequestContext();
    logger.error({
      msg: "cart_outbox_persist_failed",
      dedupeKey,
      requestId: ctx?.requestId,
      error: message,
    });
    recordCartMetric("cart.outbox.dispatch_failure", { phase: "persist" });
  }
}

function scheduleDispatchCartOutbox(outboxId: string): void {
  if (!outboxId) return;
  dispatchCartOutboxById(outboxId).catch((err: Error) => {
    logger.warn({
      msg: "cart_outbox_immediate_dispatch_failed",
      outboxId,
      error: err.message,
    });
  });
}

async function executeOutboxSideEffects(
  eventType: CartOutboxEventType,
  payload: Record<string, unknown>,
): Promise<void> {
  if (eventType === "cart.abandoned") {
    recordCartMetric("cart.abuse.suspicious", {
      userId: String(payload.userId ?? ""),
      phase: "abandoned",
    });
  }
  // Analytics hooks: extend with queue workers without blocking API path.
  void payload;
}

export async function dispatchCartOutboxById(
  outboxId: string,
): Promise<boolean> {
  const claimed = await CartEventOutbox.findOneAndUpdate(
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
    await executeOutboxSideEffects(claimed.eventType, claimed.payload);
    await CartEventOutbox.updateOne(
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
    await CartEventOutbox.updateOne(
      { _id: claimed._id },
      {
        $set: {
          status: nextStatus,
          lastError: message,
          nextAttemptAt: new Date(Date.now() + nextBackoffMs(attempts)),
        },
      },
    );
    recordCartMetric("cart.outbox.dispatch_failure", { phase: "dispatch" });
    if (terminal) {
      logOutboxDeadLetter(
        "cart",
        String(claimed._id),
        claimed.dedupeKey,
        attempts,
        message,
      );
    }
    return false;
  }
}

export async function processPendingCartOutboxBatch(
  limit = 25,
): Promise<number> {
  const pending = await CartEventOutbox.find({
    status: { $in: ["pending", "failed"] },
    nextAttemptAt: { $lte: new Date() },
    attempts: { $lt: MAX_ATTEMPTS },
  })
    .sort({ nextAttemptAt: 1 })
    .limit(limit)
    .select("_id")
    .lean();

  let dispatched = 0;
  for (const row of pending) {
    const ok = await dispatchCartOutboxById(String(row._id));
    if (ok) dispatched += 1;
  }
  return dispatched;
}
