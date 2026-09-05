/** Fields required for storefront cards (stock + swatches). Never include costPrice. */
export const LISTING_PROJECTION =
  "name slug description shortDescription price comparePrice images ratings category categoryId subcategory subcategoryId fabric isFeatured isActive isPremium premiumSlug audience sortOrderPremium premiumHeroImage totalStock soldCount viewCount variants.size variants.color variants.colorCode variants.stock variants.sku variants.price tags isGiftable isCustomizable minOrderQty occasions customFields productDetails hsnCode seoTitle seoDescription updatedAt";

export const LISTING_PROJECTION_LEAN =
  LISTING_PROJECTION.split(" ").join(" ");

/** Explicit variant fields safe for public storefront (no wholesale cost). */
export const STOREFRONT_VARIANT_SELECT =
  "variants.size variants.color variants.colorCode variants.stock variants.sku variants.price";
