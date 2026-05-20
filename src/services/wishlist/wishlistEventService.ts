import { redisConnection, redisEnabled } from '../../config/redis';
import logger from '../../utils/logger';
import { getRequestContext } from '../../utils/requestContext';
import { WISHLIST_EVENT_CHANNEL_PREFIX } from './wishlistConstants';

export type WishlistEventAction = 'added' | 'removed';

export type WishlistEventPayload = {
  userId: string;
  productId: string;
  action: WishlistEventAction;
  wishlistCount: number;
  occurredAt: string;
  requestId?: string;
  traceId?: string;
};

/**
 * Emit wishlist change events for analytics, recommendations, and realtime sync.
 * Publishes to Redis when available; workers/WebSocket gateways can subscribe later.
 */
export function emitWishlistEvent(payload: Omit<WishlistEventPayload, 'occurredAt'>): void {
  const ctx = getRequestContext();
  const event: WishlistEventPayload = {
    ...payload,
    occurredAt: new Date().toISOString(),
    requestId: ctx?.requestId,
    traceId: ctx?.traceId,
  };

  logger.info({
    msg: 'wishlist_event',
    wishlistAction: event.action,
    userId: event.userId,
    productId: event.productId,
    wishlistCount: event.wishlistCount,
    requestId: event.requestId,
    traceId: event.traceId,
  });

  if (!redisEnabled) return;

  const channel = `${WISHLIST_EVENT_CHANNEL_PREFIX}${event.userId}`;
  redisConnection.call('PUBLISH', channel, JSON.stringify(event)).catch((err: Error) => {
    logger.warn({
      msg: 'wishlist_event_publish_failed',
      userId: event.userId,
      error: err.message,
    });
  });
}
