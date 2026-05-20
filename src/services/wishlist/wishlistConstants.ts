/** Maximum saved products per user (enforced on atomic add). */
export const WISHLIST_MAX_ITEMS = 500;

/** Mongo query timeout for wishlist reads/writes. */
export const WISHLIST_QUERY_MAX_MS = 5000;

/** Full wishlist product list cache TTL (seconds). */
export const WISHLIST_LIST_CACHE_TTL_SEC = 1800;

/** Wishlist count cache TTL (seconds). */
export const WISHLIST_COUNT_CACHE_TTL_SEC = 1800;

/** Redis channel prefix for realtime sync (WebSocket workers can subscribe). */
export const WISHLIST_EVENT_CHANNEL_PREFIX = 'wishlist:events:';

/** Product fields returned to clients (matches legacy populate select + inventory). */
export const WISHLIST_PRODUCT_SELECT =
  'name slug images price comparePrice ratings category isActive totalStock variants.stock';
