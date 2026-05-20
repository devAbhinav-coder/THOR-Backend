import { redisEnabled, redisConnection } from '../../config/redis';
import { getRequestContext } from '../../utils/requestContext';
import logger from '../../utils/logger';

const ANALYTICS_PREFIX = 'analytics:review:';

/**
 * Product-level review analytics (seller dashboards / quality insights).
 * Non-blocking Redis counters; safe when Redis is disabled.
 */
export function recordProductReviewAnalytics(
  productId: string,
  event: 'created' | 'deleted' | 'reported',
  rating?: number
): void {
  const ctx = getRequestContext();
  logger.info({
    msg: 'review_product_analytics',
    productId,
    event,
    rating,
    requestId: ctx?.requestId,
  });

  if (!redisEnabled) return;
  const day = new Date().toISOString().slice(0, 10);
  const base = `${ANALYTICS_PREFIX}${productId}:${day}`;
  redisConnection.incr(`${base}:${event}`).catch(() => {});
  redisConnection.expire(`${base}:${event}`, 60 * 60 * 24 * 90).catch(() => {});
  if (event === 'created' && typeof rating === 'number') {
    redisConnection.call('HINCRBY', `${base}:ratings`, String(rating), '1').catch(() => {});
    redisConnection.expire(`${base}:ratings`, 60 * 60 * 24 * 90).catch(() => {});
  }
}
