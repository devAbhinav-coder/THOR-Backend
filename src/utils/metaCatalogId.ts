/** Keep in sync with `frontend/src/lib/metaCatalogId.ts`. */
export type MetaCatalogVariantRef = {
  sku?: string;
  _id?: string;
};

export function getMetaCatalogItemId(
  productId: string | undefined,
  variant?: MetaCatalogVariantRef | null,
): string {
  const sku = variant?.sku?.trim();
  if (sku) return sku;

  const variantId =
    variant?._id != null && String(variant._id).trim() ?
      String(variant._id).trim()
    : "";

  const pid = productId != null ? String(productId).trim() : "";
  if (pid && variantId) return `${pid}_${variantId}`;
  if (pid) return pid;
  return variantId || "unknown";
}

export function getMetaItemGroupId(productId: string): string {
  return String(productId);
}
