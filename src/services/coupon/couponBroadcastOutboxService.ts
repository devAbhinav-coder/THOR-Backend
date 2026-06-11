import CouponBroadcastOutbox from "../../models/CouponBroadcastOutbox";
import { emailTemplates } from "../emailService";
import logger from "../../types/utils/logger";
import { getRequestContext } from "../../types/utils/requestContext";
import { recordCouponMetric } from "./couponMetricsService";
import { couponBroadcastService } from "./couponBroadcastService";

const MAX_ATTEMPTS = 6;
const BASE_BACKOFF_MS = 2000;

function nextBackoffMs(attempts: number): number {
  return Math.min(BASE_BACKOFF_MS * 2 ** attempts, 60 * 60 * 1000);
}

export async function recordCouponOutbox(payload: {
  dedupeKey: string;
  couponId: string;
  code: string;
  description: string;
}): Promise<string | null> {
  try {
    const doc = await CouponBroadcastOutbox.findOneAndUpdate(
      { dedupeKey: payload.dedupeKey },
      {
        $setOnInsert: {
          dedupeKey: payload.dedupeKey,
          couponId: payload.couponId,
          code: payload.code,
          description: payload.description,
          status: "pending",
          attempts: 0,
          nextAttemptAt: new Date(),
        },
      },
      { upsert: true, new: true },
    ).lean();

    if (!doc) return null;
    if (doc.status === "completed") return String(doc._id);
    return String(doc._id);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "outbox write failed";
    const ctx = getRequestContext();
    logger.error({
      msg: "coupon_broadcast_outbox_persist_failed",
      dedupeKey: payload.dedupeKey,
      requestId: ctx?.requestId,
      error: message,
    });
    return null;
  }
}

export function scheduleCouponBroadcastDispatch(
  outboxId: string,
  run: () => Promise<number>,
): void {
  dispatchCouponBroadcastById(outboxId, run).catch((err: Error) => {
    logger.warn({
      msg: "coupon_broadcast_immediate_dispatch_failed",
      outboxId,
      error: err.message,
    });
  });
}

export async function dispatchCouponBroadcastById(
  outboxId: string,
  run?: () => Promise<number>,
): Promise<boolean> {
  const claimed = await CouponBroadcastOutbox.findOneAndUpdate(
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
    const tpl = emailTemplates.couponAnnouncement(
      claimed.code,
      claimed.description,
    );
    if (run) {
      await run();
    } else {
      await couponBroadcastService.dispatchAnnouncement(
        claimed.code,
        claimed.description,
        claimed.couponId,
        tpl,
      );
    }

    await CouponBroadcastOutbox.updateOne(
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
    await CouponBroadcastOutbox.updateOne(
      { _id: claimed._id },
      {
        $set: {
          status: terminal ? "failed" : "pending",
          lastError: message,
          nextAttemptAt: new Date(Date.now() + nextBackoffMs(attempts)),
        },
      },
    );
    recordCouponMetric("coupon.broadcast.outbox_failure", {
      outboxId,
      terminal,
    });
    return false;
  }
}

export async function processPendingCouponBroadcastBatch(
  limit = 20,
): Promise<number> {
  const pending = await CouponBroadcastOutbox.find({
    status: { $in: ["pending", "failed"] },
    nextAttemptAt: { $lte: new Date() },
  })
    .sort({ nextAttemptAt: 1 })
    .limit(limit)
    .select("_id")
    .lean();

  let dispatched = 0;
  for (const row of pending) {
    const ok = await dispatchCouponBroadcastById(String(row._id));
    if (ok) dispatched++;
  }
  return dispatched;
}
