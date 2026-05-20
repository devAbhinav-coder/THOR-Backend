import IORedis from 'ioredis';
import logger from '../utils/logger';
import { redisEnabled, redisConnection } from '../config/redis';
import { CART_EVENT_CHANNEL_PREFIX } from '../services/cart/cartConstants';
import type { CartEventPayload } from '../services/cart/cartEventService';
import { broadcastCartChangeToUser } from '../services/cart/cartSyncHub';

let subscriber: IORedis | null = null;

export function startCartSyncSubscriber(): void {
  if (!redisEnabled) {
    logger.info('Cart sync subscriber skipped (Redis not configured)');
    return;
  }
  if (process.env.CART_SYNC_SUBSCRIBER_ENABLED === 'false') {
    logger.info('Cart sync subscriber disabled (CART_SYNC_SUBSCRIBER_ENABLED=false)');
    return;
  }
  if (!(redisConnection instanceof IORedis)) {
    logger.warn('Cart sync subscriber requires real Redis (not in-memory fallback)');
    return;
  }
  if (subscriber) return;

  subscriber = redisConnection.duplicate();
  const pattern = `${CART_EVENT_CHANNEL_PREFIX}*`;

  subscriber.on('pmessage', (_pattern: string, channel: string, message: string) => {
    try {
      const userId = channel.slice(CART_EVENT_CHANNEL_PREFIX.length);
      if (!userId) return;
      const event = JSON.parse(message) as CartEventPayload;
      broadcastCartChangeToUser(userId, event);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'parse failed';
      logger.warn({ msg: 'cart_sync_subscriber_message_error', error: msg });
    }
  });

  subscriber.on('error', (err: Error) => {
    logger.warn({ msg: 'cart_sync_subscriber_error', error: err.message });
  });

  subscriber.psubscribe(pattern, (err) => {
    if (err) {
      logger.error({ msg: 'cart_sync_subscriber_subscribe_failed', error: err.message });
      return;
    }
    logger.info(`Cart sync subscriber listening on ${pattern}`);
  });
}

export async function stopCartSyncSubscriber(): Promise<void> {
  if (!subscriber) return;
  const sub = subscriber;
  subscriber = null;
  try {
    await sub.punsubscribe();
    await sub.quit();
  } catch {
    /* ignore */
  }
}
