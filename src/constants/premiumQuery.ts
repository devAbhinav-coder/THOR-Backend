/** Fields returned for premium collection listing + PDP (no wholesale costPrice). */
export const PREMIUM_PRODUCT_SELECT =
  "name slug premiumSlug premiumSubtitle description shortDescription category subcategory fabric careInstructions highlights occasions tags price comparePrice images premiumHeroImage craftNote weaveHours premiumEditorialOpen premiumEditorialClose variants.size variants.color variants.colorCode variants.stock variants.sku variants.price totalStock isActive isPremium sortOrderPremium ratings viewCount soldCount productDetails motionVideoUrl motionVideoPublicId motionReelUrl seoTitle seoDescription hsnCode createdAt updatedAt";

export const PREMIUM_PRODUCT_CACHE_TTL = 120;
export const PREMIUM_QUERY_MAX_MS = 8000;
/** Bump when public premium JSON shape changes (e.g. costPrice strip). */
export const PREMIUM_CACHE_SHAPE_VERSION = 4;
