import Product from "../models/Product";
import {
  OFFLINE_MANUAL_PRODUCT_TAG,
  OFFLINE_MANUAL_VARIANT_SKU,
} from "../constants/offlineOrder";

const PLACEHOLDER_IMAGE = {
  url: "https://images.unsplash.com/photo-1558618666-fcd25c85cd64?w=400&h=400&fit=crop",
  publicId: "offline-system/line-item-placeholder",
};

/**
 * Ensures a catalog Product exists for manual offline line items (Mongo requires a product ref).
 * Hidden from storefront via {@link OFFLINE_MANUAL_PRODUCT_TAG}.
 */
export async function getOrCreateOfflineManualProduct() {
  const existing = await Product.findOne({ tags: OFFLINE_MANUAL_PRODUCT_TAG });
  if (existing) return existing;

  return Product.create({
    name: "Offline custom line (system)",
    description:
      "Internal placeholder for manual items entered on admin offline orders. Not shown in the shop catalog.",
    shortDescription: "System",
    price: 0,
    category: "Internal",
    images: [PLACEHOLDER_IMAGE],
    variants: [{ sku: OFFLINE_MANUAL_VARIANT_SKU, stock: 999_999 }],
    tags: [OFFLINE_MANUAL_PRODUCT_TAG],
    isActive: true,
    isFeatured: false,
    isGiftable: false,
    isCustomizable: false,
    minOrderQty: 1,
    occasions: [],
    customFields: [],
    totalStock: 999_999,
  });
}

export function isOfflineManualProductId(
  productId: { toString(): string } | string,
  offlineProductId: { toString(): string } | string,
): boolean {
  return String(productId) === String(offlineProductId);
}

export { OFFLINE_MANUAL_VARIANT_SKU };
