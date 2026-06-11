import { getCache, setCache, deleteCache } from "../cacheService";
import { redisConnection, redisEnabled } from "../../config/redis";
import logger from "../../types/utils/logger";
import { getRequestContext } from "../../types/utils/requestContext";
import {
  WISHLIST_LIST_CACHE_TTL_SEC,
  WISHLIST_COUNT_CACHE_TTL_SEC,
} from "./wishlistConstants";
import type { WishlistProductDto } from "./wishlistDto";

export type WishlistListCachePayload = {
  products: WishlistProductDto[];
  total?: number;
};

function listCacheKey(userId: string, page?: number, limit?: number): string {
  if (page === undefined && limit === undefined) {
    return `cache:wishlist:${userId}`;
  }
  return `cache:wishlist:${userId}:p${page}:l${limit}`;
}

function countCacheKey(userId: string): string {
  return `cache:wishlist:count:${userId}`;
}

export const wishlistCacheService = {
  async getList(
    userId: string,
    page?: number,
    limit?: number,
  ): Promise<WishlistListCachePayload | null> {
    return getCache<WishlistListCachePayload>(
      listCacheKey(userId, page, limit),
    );
  },

  async setList(
    userId: string,
    payload: WishlistListCachePayload,
    page?: number,
    limit?: number,
  ): Promise<void> {
    await setCache(
      listCacheKey(userId, page, limit),
      payload,
      WISHLIST_LIST_CACHE_TTL_SEC,
    );
  },

  async getCount(userId: string): Promise<number | null> {
    return getCache<number>(countCacheKey(userId));
  },

  async setCount(userId: string, count: number): Promise<void> {
    await setCache(countCacheKey(userId), count, WISHLIST_COUNT_CACHE_TTL_SEC);
  },

  /** Invalidate all wishlist cache keys for a user (list variants + count). */
  scheduleInvalidate(userId: string): void {
    this.invalidate(userId).catch((err: Error) => {
      const ctx = getRequestContext();
      logger.warn({
        msg: "wishlist_cache_invalidation_failed",
        userId,
        requestId: ctx?.requestId,
        error: err.message,
      });
    });
  },

  async invalidate(userId: string): Promise<void> {
    await deleteCache(listCacheKey(userId));
    await deleteCache(countCacheKey(userId));
    if (!redisEnabled) return;
    const pattern = `cache:wishlist:${userId}:*`;
    try {
      const keys = await redisConnection.keys(pattern);
      if (keys.length) await redisConnection.del(...keys);
    } catch {
      // Non-fatal; primary keys already cleared
    }
  },
};
