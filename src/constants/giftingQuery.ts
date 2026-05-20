export const GIFTING_QUERY_MAX_MS = Number(process.env.GIFTING_QUERY_MAX_MS || 12_000);

export const GIFTING_PRODUCT_CACHE_TTL = Number(process.env.GIFTING_PRODUCT_CACHE_TTL || 120);

export const GIFTING_RANDOM_POOL_TTL = Number(process.env.GIFTING_RANDOM_POOL_TTL || 300);

export const GIFTABLE_PRODUCT_SELECT =
  'name slug price comparePrice images category description shortDescription tags giftOccasions isFeatured isActive minOrderQty isCustomizable customFields productDetails variants';
