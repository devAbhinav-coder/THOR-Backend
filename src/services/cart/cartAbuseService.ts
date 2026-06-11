import { redisEnabled, redisConnection } from "../../config/redis";
import logger from "../../types/utils/logger";
import { getRequestContext } from "../../types/utils/requestContext";
import { recordCartMetric } from "./cartMetricsService";

const MUTATION_WINDOW_SEC = Number(process.env.CART_MUTATION_WINDOW_SEC || 60);
const MUTATION_THRESHOLD = Number(process.env.CART_MUTATION_THRESHOLD || 40);

function mutationKey(userId: string, ip: string): string {
  return `cart:abuse:mutation:${userId}:${ip}`;
}

export async function recordCartMutationAttempt(
  userId: string,
  ip: string,
): Promise<void> {
  if (!redisEnabled) return;
  const key = mutationKey(userId, ip);
  const count = await redisConnection.incr(key);
  if (count === 1) {
    await redisConnection.expire(key, MUTATION_WINDOW_SEC);
  }
  if (count >= MUTATION_THRESHOLD) {
    const ctx = getRequestContext();
    logger.warn({
      msg: "cart_abuse_suspicious",
      userId,
      ip,
      mutationCount: count,
      requestId: ctx?.requestId,
    });
    recordCartMetric("cart.abuse.suspicious", { userId, ip });
  }
}

export async function isCartMutationThrottled(
  userId: string,
  ip: string,
): Promise<boolean> {
  if (!redisEnabled) return false;
  const raw = await redisConnection.get(mutationKey(userId, ip));
  if (!raw) return false;
  return Number(raw) >= MUTATION_THRESHOLD * 2;
}
