import { redisConnection, redisEnabled } from '../../config/redis';
import logger from '../../utils/logger';
import { getRequestContext } from '../../utils/requestContext';
import { REVIEW_EVENT_CHANNEL_PREFIX } from './reviewConstants';

export type ReviewEventType =
  | 'review.created'
  | 'review.helpful_vote'
  | 'review.reported'
  | 'review.deleted'
  | 'review.moderated';

export type ReviewEventPayload = {
  type: ReviewEventType;
  reviewId: string;
  productId?: string;
  userId?: string;
  occurredAt: string;
  requestId?: string;
  traceId?: string;
  meta?: Record<string, unknown>;
};

export function emitReviewEvent(
  payload: Omit<ReviewEventPayload, 'occurredAt'>
): void {
  const ctx = getRequestContext();
  const event: ReviewEventPayload = {
    ...payload,
    occurredAt: new Date().toISOString(),
    requestId: ctx?.requestId,
    traceId: ctx?.traceId,
  };

  logger.info({
    msg: 'review_event',
    reviewEventType: event.type,
    reviewId: event.reviewId,
    productId: event.productId,
    userId: event.userId,
    requestId: event.requestId,
    traceId: event.traceId,
    meta: event.meta,
  });

  if (!redisEnabled) return;

  const channel = `${REVIEW_EVENT_CHANNEL_PREFIX}${event.type}`;
  redisConnection.call('PUBLISH', channel, JSON.stringify(event)).catch((err: Error) => {
    logger.warn({
      msg: 'review_event_publish_failed',
      reviewId: event.reviewId,
      error: err.message,
    });
  });
}
