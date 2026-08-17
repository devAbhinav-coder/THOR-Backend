import Product from "../models/Product";
import {
  OFFLINE_MANUAL_PRODUCT_TAG,
  OFFLINE_MANUAL_SYSTEM_PRODUCT_IMAGE,
  OFFLINE_MANUAL_VARIANT_SKU,
} from "../constants/offlineOrder";
import type { IProduct } from "../types";

/**
 * Ensures a catalog Product exists for manual offline line items (Mongo requires a product ref).
 * Hidden from storefront, admin inventory, and product search via {@link OFFLINE_MANUAL_PRODUCT_TAG}.
 */
export async function getOrCreateOfflineManualProduct(): Promise<IProduct> {
  let existing = await Product.findOne({ tags: OFFLINE_MANUAL_PRODUCT_TAG });
  if (existing) {
    await sanitizeOfflineManualProduct(existing);
    return existing;
  }

  const created = await Product.create({
    name: "Offline custom line (system)",
    description:
      "Internal placeholder for manual items entered on admin offline orders. Not shown in the shop catalog.",
    shortDescription: "System",
    price: 0,
    category: "Internal",
    images: [OFFLINE_MANUAL_SYSTEM_PRODUCT_IMAGE],
    variants: [{ sku: OFFLINE_MANUAL_VARIANT_SKU, stock: 0 }],
    tags: [OFFLINE_MANUAL_PRODUCT_TAG],
    isActive: false,
    isFeatured: false,
    isGiftable: false,
    isCustomizable: false,
    minOrderQty: 1,
    occasions: [],
    customFields: [],
    totalStock: 0,
  });

  return created;
}

/** Keep the placeholder product invisible and off inventory totals. */
async function sanitizeOfflineManualProduct(doc: IProduct): Promise<void> {
  let dirty = false;

  if (doc.isActive !== false) {
    doc.isActive = false;
    dirty = true;
  }
  if ((doc.totalStock ?? 0) !== 0) {
    doc.totalStock = 0;
    dirty = true;
  }

  const variant = doc.variants.find((v) => v.sku === OFFLINE_MANUAL_VARIANT_SKU);
  if (variant && (variant.stock ?? 0) !== 0) {
    variant.stock = 0;
    dirty = true;
  }
  if (!variant) {
    doc.variants.push({ sku: OFFLINE_MANUAL_VARIANT_SKU, stock: 0 });
    dirty = true;
  }

  const hasLegacyImage =
    Array.isArray(doc.images) &&
    doc.images.some(
      (img) =>
        typeof img?.url === "string" &&
        (img.url.includes("unsplash.com") ||
          img.url.includes("photo-1558618666") ||
          !img.url.startsWith("data:image/svg+xml")),
    );
  if (hasLegacyImage) {
    doc.images = [OFFLINE_MANUAL_SYSTEM_PRODUCT_IMAGE];
    dirty = true;
  }

  if (doc.category !== "Internal") {
    doc.category = "Internal";
    dirty = true;
  }

  if (dirty) await doc.save();
}

export function isOfflineManualProductId(
  productId: { toString(): string } | string,
  offlineProductId: { toString(): string } | string,
): boolean {
  return String(productId) === String(offlineProductId);
}

export { OFFLINE_MANUAL_VARIANT_SKU };
