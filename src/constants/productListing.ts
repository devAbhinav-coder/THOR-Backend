/** Fields required for storefront cards (stock + swatches). */
export const LISTING_PROJECTION =
  "name slug price comparePrice images ratings category fabric isFeatured isActive totalStock variants.size variants.color variants.colorCode variants.stock variants.sku tags isGiftable isCustomizable customFields";

export const LISTING_PROJECTION_LEAN =
  LISTING_PROJECTION.split(" ").join(" ");
