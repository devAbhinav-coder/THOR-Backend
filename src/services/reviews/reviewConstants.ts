/** Query timeout for review reads (ms). */
export const REVIEW_QUERY_MAX_MS = 8_000;

/** Featured reviews cache. */
export const FEATURED_REVIEWS_CACHE_KEY = 'reviews:featured';
export const FEATURED_REVIEWS_TTL_SEC = 300;

/** Product list / summary cache TTLs (seconds). */
export const PRODUCT_REVIEWS_CACHE_TTL_SEC = 120;
export const PRODUCT_RATING_SUMMARY_CACHE_TTL_SEC = 300;

export const REVIEW_EVENT_CHANNEL_PREFIX = 'events:reviews:';

/** Max images per review (matches multer). */
export const REVIEW_MAX_IMAGES = 5;

/** Max review image size in bytes (matches multer). */
export const REVIEW_MAX_IMAGE_BYTES = 30 * 1024 * 1024;

/** Days after creation when user may still edit rating/title/comment. */
export const REVIEW_EDIT_WINDOW_DAYS = 30;

/** Idempotency key TTL for create review (seconds). */
export const REVIEW_IDEMPOTENCY_TTL_SEC = 86_400;

export const ALLOWED_REPORT_REASONS = ['spam', 'abusive', 'misleading', 'other'] as const;
export type ReportReason = (typeof ALLOWED_REPORT_REASONS)[number];

export const REVIEW_STATUSES = ['visible', 'hidden', 'flagged', 'pending_moderation'] as const;
export type ReviewStatus = (typeof REVIEW_STATUSES)[number];

export type ReviewSortKey = 'newest' | 'highest' | 'helpful' | 'images';

export const REVIEW_SORT_OPTIONS: Record<ReviewSortKey, Record<string, 1 | -1>> = {
  newest: { createdAt: -1 },
  highest: { rating: -1, createdAt: -1 },
  helpful: { helpfulCount: -1, createdAt: -1 },
  images: { createdAt: -1 },
};

/** Mongo filter: publicly visible reviews (backward compatible with legacy docs). */
export const PUBLIC_REVIEW_FILTER = {
  $and: [
    {
      $or: [{ status: 'visible' }, { status: { $exists: false } }],
    },
    {
      $or: [{ deletedAt: null }, { deletedAt: { $exists: false } }],
    },
  ],
};

export function productReviewsCacheKey(
  productId: string,
  page: number,
  limit: number,
  sort: ReviewSortKey
): string {
  return `cache:reviews:product:${productId}:p${page}:l${limit}:s${sort}`;
}

export function productRatingSummaryCacheKey(productId: string): string {
  return `cache:reviews:summary:${productId}`;
}

export function reviewIdempotencyCacheKey(userId: string, key: string): string {
  return `cache:reviews:idempotency:${userId}:${key}`;
}
