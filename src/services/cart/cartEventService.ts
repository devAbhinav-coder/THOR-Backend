import { redisConnection, redisEnabled } from '../../config/redis';
import logger from '../../utils/logger';
import { getRequestContext } from '../../utils/requestContext';
import { CART_EVENT_CHANNEL_PREFIX } from './cartConstants';
import { enqueueCartOutboxEvent } from './cartOutboxService';

export type CartEventType =
  | 'cart.item.added'
  | 'cart.item.removed'
  | 'cart.item.updated'
  | 'cart.coupon.applied'
  | 'cart.coupon.removed'
  | 'cart.cleared'
  | 'cart.abandoned';

export type CartEventPayload = {
  type: CartEventType;
  userId: string;
  cartId?: string;
  productId?: string;
  cartItemId?: string;
  couponCode?: string;
  quantity?: number;
  occurredAt: string;
  requestId?: string;
  traceId?: string;
};

export function emitCartEvent(
  payload: Omit<CartEventPayload, 'occurredAt'>
): void {
  const ctx = getRequestContext();
  const event: CartEventPayload = {
    ...payload,
    occurredAt: new Date().toISOString(),
    requestId: ctx?.requestId,
    traceId: ctx?.traceId,
  };

  logger.info({
    msg: 'cart_event',
    cartEventType: event.type,
    userId: event.userId,
    productId: event.productId,
    cartItemId: event.cartItemId,
    couponCode: event.couponCode,
    requestId: event.requestId,
    traceId: event.traceId,
  });

  const dedupeKey = `${event.type}:${event.userId}:${event.cartItemId ?? ''}:${event.productId ?? ''}:${event.couponCode ?? ''}:${event.occurredAt.slice(0, 16)}`;
  enqueueCartOutboxEvent(event.type, event as unknown as Record<string, unknown>, dedupeKey).catch(
    () => {}
  );

  if (!redisEnabled) return;
  const channel = `${CART_EVENT_CHANNEL_PREFIX}${event.userId}`;
  redisConnection.call('PUBLISH', channel, JSON.stringify(event)).catch((err: Error) => {
    logger.warn({
      msg: 'cart_event_publish_failed',
      userId: event.userId,
      error: err.message,
    });
  });
}
