import logger from "../types/utils/logger";
import { getRedisClient } from "../config/redis";
import { CART_EVENT_CHANNEL_PREFIX } from "../services/cart/cartConstants";
import type { CartEventPayload } from "../services/cart/cartEventService";
import { broadcastCartChangeToUser } from "../services/cart/cartSyncHub";
import type IORedis from "ioredis";

let subscriber: IORedis | null = null;

export function startCartSyncSubscriber(): void {
  const redis = getRedisClient();
  if (!redis) {
    logger.info("Cart sync subscriber skipped (Redis not available)");
    return;
  }
  if (process.env.CART_SYNC_SUBSCRIBER_ENABLED === "false") {
    logger.info(
      "Cart sync subscriber disabled (CART_SYNC_SUBSCRIBER_ENABLED=false)",
    );
    return;
  }
  if (subscriber) return;

  subscriber = redis.duplicate();
  const pattern = `${CART_EVENT_CHANNEL_PREFIX}*`;

  subscriber.on(
    "pmessage",
    (_pattern: string, channel: string, message: string) => {
      try {
        const userId = channel.slice(CART_EVENT_CHANNEL_PREFIX.length);
        if (!userId) return;
        const event = JSON.parse(message) as CartEventPayload;
        broadcastCartChangeToUser(userId, event);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : "parse failed";
        logger.warn({ msg: "cart_sync_subscriber_message_error", error: msg });
      }
    },
  );

  subscriber.on("error", (err: Error) => {
    logger.warn({ msg: "cart_sync_subscriber_error", error: err.message });
  });

  subscriber.psubscribe(pattern, (err) => {
    if (err) {
      logger.error({
        msg: "cart_sync_subscriber_subscribe_failed",
        error: err.message,
      });
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
