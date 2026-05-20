import OrderEventOutbox from '../models/OrderEventOutbox';
import { OrderEventPayload } from '../events/orderEvents';
import { enqueueOrderEvent } from '../queues/orderQueue';
import logger from '../utils/logger';
import { getRequestContext } from '../utils/requestContext';
import { recordOrderMetric } from './orderMetricsService';

const MAX_ATTEMPTS = 8;
const BASE_BACKOFF_MS = 2000;

function buildDedupeKey(payload: OrderEventPayload): string {
  return `${payload.eventType}:${payload.orderId}`;
}

function nextBackoffMs(attempts: number): number {
  return Math.min(BASE_BACKOFF_MS * 2 ** attempts, 60 * 60 * 1000);
}

/**
 * Persist event durably, then attempt immediate dispatch (non-blocking for API).
 */
export async function recordOrderEvent(payload: OrderEventPayload): Promise<string | null> {
  const dedupeKey = buildDedupeKey(payload);
  const ctx = getRequestContext();

  try {
    const doc = await OrderEventOutbox.findOneAndUpdate(
      { dedupeKey },
      {
        $setOnInsert: {
          dedupeKey,
          eventType: payload.eventType,
          payload: payload as unknown as Record<string, unknown>,
          status: 'pending',
          attempts: 0,
          nextAttemptAt: new Date(),
        },
      },
      { upsert: true, new: true }
    ).lean();

    if (!doc) return null;

    if (doc.status === 'completed') {
      return String(doc._id);
    }

    scheduleDispatchOutboxEntry(String(doc._id));
    return String(doc._id);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'outbox write failed';
    logger.error({
      msg: 'order_outbox_persist_failed',
      dedupeKey,
      requestId: ctx?.requestId,
      error: message,
    });
    recordOrderMetric('order.outbox.dispatch_failure', { phase: 'persist' });
    return null;
  }
}

export function scheduleDispatchOutboxEntry(outboxId: string): void {
  dispatchOutboxById(outboxId).catch((err: Error) => {
    logger.warn({
      msg: 'order_outbox_immediate_dispatch_failed',
      outboxId,
      error: err.message,
    });
  });
}

export async function dispatchOutboxById(outboxId: string): Promise<boolean> {
  const claimed = await OrderEventOutbox.findOneAndUpdate(
    {
      _id: outboxId,
      status: { $in: ['pending', 'failed'] },
      nextAttemptAt: { $lte: new Date() },
    },
    { $set: { status: 'processing' }, $inc: { attempts: 1 } },
    { new: true }
  );

  if (!claimed) return false;

  try {
    await enqueueOrderEvent(claimed.payload as unknown as OrderEventPayload);
    await OrderEventOutbox.updateOne(
      { _id: claimed._id },
      { $set: { status: 'completed', processedAt: new Date(), lastError: undefined } }
    );
    return true;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'dispatch failed';
    const attempts = claimed.attempts;
    const terminal = attempts >= MAX_ATTEMPTS;
    await OrderEventOutbox.updateOne(
      { _id: claimed._id },
      {
        $set: {
          status: terminal ? 'failed' : 'pending',
          lastError: message.slice(0, 500),
          nextAttemptAt: new Date(Date.now() + nextBackoffMs(attempts)),
        },
      }
    );
    recordOrderMetric('order.outbox.dispatch_failure', { terminal, attempts });
    logger.error({
      msg: 'order_outbox_dispatch_failed',
      outboxId: String(claimed._id),
      dedupeKey: claimed.dedupeKey,
      attempts,
      error: message,
    });
    return false;
  }
}

/** Poll pending/failed outbox rows — run from background job */
export async function processPendingOutboxBatch(limit = 25): Promise<number> {
  const now = new Date();
  const pending = await OrderEventOutbox.find({
    status: { $in: ['pending', 'failed'] },
    nextAttemptAt: { $lte: now },
    attempts: { $lt: MAX_ATTEMPTS },
  })
    .sort({ nextAttemptAt: 1 })
    .limit(limit)
    .select('_id')
    .lean()
    .maxTimeMS(5000);

  let dispatched = 0;
  for (const row of pending) {
    const ok = await dispatchOutboxById(String(row._id));
    if (ok) dispatched += 1;
  }
  return dispatched;
}
