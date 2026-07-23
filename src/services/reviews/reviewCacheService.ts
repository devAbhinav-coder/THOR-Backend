import { getCache, setCache, deleteCache } from "../cacheService";
import { redisConnection, redisEnabled } from "../../config/redis";
import logger from "../../types/utils/logger";
import { getRequestContext } from "../../types/utils/requestContext";
import {
  FEATURED_REVIEWS_CACHE_KEY,
  FEATURED_REVIEWS_TTL_SEC,
  PRODUCT_REVIEWS_CACHE_TTL_SEC,
  PRODUCT_RATING_SUMMARY_CACHE_TTL_SEC,
  productReviewsCacheKey,
  productRatingSummaryCacheKey,
  ReviewSortKey,
} from "./reviewConstants";

export type FeaturedReviewsCachePayload = {
  reviews: Record<string, unknown>[];
  results: number;
};

export type ProductReviewsCachePayload = {
  reviews: Record<string, unknown>[];
  ratingDistribution: { _id: number; count: number }[];
  total: number;
};

export type RatingSummaryCachePayload = {
  ratingDistribution: { _id: number; count: number }[];
  total: number;
};

export const reviewCacheService = {
  async getFeatured(): Promise<FeaturedReviewsCachePayload | null> {
    return getCache<FeaturedReviewsCachePayload>(FEATURED_REVIEWS_CACHE_KEY);
  },

  async setFeatured(payload: FeaturedReviewsCachePayload): Promise<void> {
    await setCache(
      FEATURED_REVIEWS_CACHE_KEY,
      payload,
      FEATURED_REVIEWS_TTL_SEC,
    );
  },

  async getProductPage(
    productId: string,
    page: number,
    limit: number,
    sort: ReviewSortKey,
  ): Promise<ProductReviewsCachePayload | null> {
    return getCache<ProductReviewsCachePayload>(
      productReviewsCacheKey(productId, page, limit, sort),
    );
  },

  async setProductPage(
    productId: string,
    page: number,
    limit: number,
    sort: ReviewSortKey,
    payload: ProductReviewsCachePayload,
  ): Promise<void> {
    await setCache(
      productReviewsCacheKey(productId, page, limit, sort),
      payload,
      PRODUCT_REVIEWS_CACHE_TTL_SEC,
    );
  },

  async getRatingSummary(
    productId: string,
  ): Promise<RatingSummaryCachePayload | null> {
    return getCache<RatingSummaryCachePayload>(
      productRatingSummaryCacheKey(productId),
    );
  },

  async setRatingSummary(
    productId: string,
    payload: RatingSummaryCachePayload,
  ): Promise<void> {
    await setCache(
      productRatingSummaryCacheKey(productId),
      payload,
      PRODUCT_RATING_SUMMARY_CACHE_TTL_SEC,
    );
  },

  scheduleInvalidateProduct(productId: string): void {
    this.invalidateProduct(productId).catch((err: Error) => {
      const ctx = getRequestContext();
      logger.warn({
        msg: "review_cache_invalidation_failed",
        productId,
        requestId: ctx?.requestId,
        error: err.message,
      });
    });
  },

  scheduleInvalidateFeatured(): void {
    deleteCache(FEATURED_REVIEWS_CACHE_KEY).catch((err: Error) => {
      const ctx = getRequestContext();
      logger.warn({
        msg: "review_featured_cache_invalidation_failed",
        requestId: ctx?.requestId,
        error: err.message,
      });
    });
    deleteCache("cache:testimonials:home:v3").catch(() => {});
  },

  async invalidateProduct(productId: string): Promise<void> {
    await deleteCache(productRatingSummaryCacheKey(productId));
    await deleteCache(FEATURED_REVIEWS_CACHE_KEY);
    await deleteCache("cache:testimonials:home:v3");
    if (!redisEnabled) return;
    const pattern = `cache:reviews:product:${productId}:*`;
    try {
      const keys = await redisConnection.keys(pattern);
      if (keys.length) await redisConnection.del(...keys);
    } catch {
      // Non-fatal
    }
  },

  async invalidateAll(): Promise<void> {
    await deleteCache(FEATURED_REVIEWS_CACHE_KEY);
    if (!redisEnabled) return;
    try {
      const keys = await redisConnection.keys("cache:reviews:*");
      if (keys.length) await redisConnection.del(...keys);
    } catch {
      // Non-fatal
    }
  },
};
