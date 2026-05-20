/** Cart Redis cache TTL (seconds). */
export const CART_CACHE_TTL_SEC = 1800;

/** Cart mutation distributed lock TTL (seconds). */
export const CART_LOCK_TTL_SEC = 8;

/** Max optimistic-lock retries on version conflict. */
export const CART_VERSION_MAX_RETRIES = 3;

/** Mongo query timeout for cart-related reads. */
export const CART_QUERY_MAX_MS = 5000;

/** Idempotency replay window for cart mutations (seconds). */
export const CART_IDEMPOTENCY_TTL_SEC = 300;

/** Redis pub/sub channel prefix for realtime cart sync. */
export const CART_EVENT_CHANNEL_PREFIX = 'cart:events:';

export const CART_CACHE_KEY_PREFIX = 'cache:cart:v2:';
export const CART_LOCK_KEY_PREFIX = 'lock:cart:';
export const CART_IDEMPOTENCY_KEY_PREFIX = 'cache:cart:idempotency:';

/** Product fields required for add-to-cart validation and line building. */
export const PRODUCT_FOR_CART_SELECT =
  'name slug images isActive price variants customFields giftOccasions minOrderQty';

export const PRODUCT_MIN_QTY_SELECT = 'minOrderQty giftOccasions';

export const COUPON_LOOKUP_SELECT = 'code discountType discountValue isActive expiresAt minOrderValue maxUses usedCount usedBy';
