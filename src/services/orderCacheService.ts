import { redisConnection } from "../config/redis";
import { deleteCache } from "./cacheService";
import logger from "../types/utils/logger";
import { getRequestContext } from "../types/utils/requestContext";

const VERSION_TTL_SEC = 60 * 60 * 24 * 30; // 30 days

function userListVersionKey(userId: string): string {
  return `cache:orders:ver:${userId}`;
}

function orderDetailKey(orderId: string, userId: string): string {
  return `cache:order:${orderId}:${userId}`;
}

export async function getUserOrdersCacheVersion(
  userId: string,
): Promise<number> {
  const raw = await redisConnection.get(userListVersionKey(userId));
  if (!raw) return 0;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) ? n : 0;
}

/** Bump list cache generation — avoids Redis KEYS wildcard scans */
export async function bumpUserOrdersCacheVersion(
  userId: string,
): Promise<number> {
  const next = await redisConnection.incr(userListVersionKey(userId));
  await redisConnection.expire(userListVersionKey(userId), VERSION_TTL_SEC);
  return next;
}

export function buildMyOrdersCacheKey(
  userId: string,
  version: number,
  skip: number,
  limit: number,
  statusStr?: string,
): string {
  const statusPart = statusStr ? statusStr.replace(/\s+/g, "") : "all";
  return `cache:orders:${userId}:v${version}:${skip}:${limit}:${statusPart}`;
}

/**
 * Targeted invalidation: version bump for list pages + optional detail key delete.
 * Safe to call without awaiting on the hot path.
 */
export async function invalidateUserOrderCache(
  userId: string,
  orderId?: string,
): Promise<void> {
  const started = Date.now();
  await bumpUserOrdersCacheVersion(userId);
  if (orderId) {
    await deleteCache(orderDetailKey(orderId, userId));
  }
  const ctx = getRequestContext();
  logger.debug({
    msg: "order_cache_invalidated",
    userId,
    orderId,
    requestId: ctx?.requestId,
    latencyMs: Date.now() - started,
  });
}

export function scheduleInvalidateUserOrderCache(
  userId: string,
  orderId?: string,
): void {
  invalidateUserOrderCache(userId, orderId).catch((err: Error) => {
    logger.warn({
      msg: "order_cache_invalidation_failed",
      userId,
      orderId,
      error: err.message,
    });
  });
}
