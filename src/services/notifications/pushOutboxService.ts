import PushNotificationOutbox from "../../models/PushNotificationOutbox";
import { enqueuePush, PushJobData } from "../../queues/pushQueue";
import logger from "../../types/utils/logger";
import { getRequestContext } from "../../types/utils/requestContext";
import { recordNotificationMetric } from "./notificationMetricsService";
import { sanitizePushPayload } from "./notificationDto";
import { buildPushDedupeKey } from "./pushDedupe";

const MAX_ATTEMPTS = 8;
const BASE_BACKOFF_MS = 2000;

function nextBackoffMs(attempts: number): number {
  return Math.min(BASE_BACKOFF_MS * 2 ** attempts, 60 * 60 * 1000);
}

export { buildPushDedupeKey } from "./pushDedupe";

export async function recordPushOutbox(
  data: PushJobData,
): Promise<string | null> {
  const safe = sanitizePushPayload(data);
  const dedupeKey = buildPushDedupeKey({ ...data, ...safe });
  const ctx = getRequestContext();

  try {
    const doc = await PushNotificationOutbox.findOneAndUpdate(
      { dedupeKey },
      {
        $setOnInsert: {
          dedupeKey,
          userId: data.userId,
          title: safe.title,
          body: safe.body,
          link: safe.link,
          notificationId: data.notificationId,
          status: "pending",
          attempts: 0,
          nextAttemptAt: new Date(),
        },
      },
      { upsert: true, new: true },
    ).lean();

    if (!doc) return null;
    if (doc.status === "completed") return String(doc._id);

    scheduleDispatchPushOutbox(String(doc._id));
    return String(doc._id);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "outbox write failed";
    logger.error({
      msg: "push_outbox_persist_failed",
      dedupeKey,
      requestId: ctx?.requestId,
      error: message,
    });
    recordNotificationMetric("push.outbox.dispatch_failure", {
      phase: "persist",
    });
    return null;
  }
}

function scheduleDispatchPushOutbox(outboxId: string): void {
  dispatchPushOutboxById(outboxId).catch((err: Error) => {
    logger.warn({
      msg: "push_outbox_immediate_dispatch_failed",
      outboxId,
      error: err.message,
    });
  });
}

async function executePushDispatch(payload: PushJobData): Promise<void> {
  const started = Date.now();
  await enqueuePush(payload, {
    jobId:
      payload.notificationId ?
        `push__${payload.userId}__${payload.notificationId}`
      : undefined,
  });
  recordNotificationMetric("push.queue.latency_ms", {
    userId: payload.userId,
    durationMs: Date.now() - started,
  });
}

export async function dispatchPushOutboxById(
  outboxId: string,
): Promise<boolean> {
  const claimed = await PushNotificationOutbox.findOneAndUpdate(
    {
      _id: outboxId,
      status: { $in: ["pending", "failed"] },
      nextAttemptAt: { $lte: new Date() },
    },
    { $set: { status: "processing" }, $inc: { attempts: 1 } },
    { new: true },
  );

  if (!claimed) return false;

  const job: PushJobData = {
    userId: claimed.userId,
    title: claimed.title,
    body: claimed.body,
    link: claimed.link,
    notificationId: claimed.notificationId,
  };

  try {
    await executePushDispatch(job);
    await PushNotificationOutbox.updateOne(
      { _id: claimed._id },
      {
        $set: {
          status: "completed",
          processedAt: new Date(),
          lastError: undefined,
        },
      },
    );
    recordNotificationMetric("push.delivery.queued", { userId: job.userId });
    return true;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "dispatch failed";
    const attempts = claimed.attempts;
    const terminal = attempts >= MAX_ATTEMPTS;
    await PushNotificationOutbox.updateOne(
      { _id: claimed._id },
      {
        $set: {
          status: terminal ? "failed" : "pending",
          lastError: message.slice(0, 500),
          nextAttemptAt: new Date(Date.now() + nextBackoffMs(attempts)),
        },
      },
    );
    recordNotificationMetric("push.outbox.dispatch_failure", {
      terminal,
      attempts,
    });
    return false;
  }
}

export async function processPendingPushOutboxBatch(
  limit = 25,
): Promise<number> {
  const pending = await PushNotificationOutbox.find({
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
    const ok = await dispatchPushOutboxById(String(row._id));
    if (ok) dispatched += 1;
  }
  return dispatched;
}
