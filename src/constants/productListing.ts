/** Fields required for storefront cards (stock + swatches). */
export const LISTING_PROJECTION =
  "name slug description shortDescription price comparePrice images ratings category subcategory fabric isFeatured isActive totalStock soldCount viewCount variants.size variants.color variants.colorCode variants.stock variants.sku variants.costPrice variants.price tags isGiftable isCustomizable minOrderQty giftOccasions customFields productDetails hsnCode seoTitle seoDescription updatedAt";

export const LISTING_PROJECTION_LEAN =
  LISTING_PROJECTION.split(" ").join(" ");
