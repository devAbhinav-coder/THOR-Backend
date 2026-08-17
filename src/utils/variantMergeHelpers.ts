import type { IProduct } from "../types";

type VariantRow = {
  sku?: string;
  size?: string;
  color?: string;
  colorCode?: string;
  stock?: number;
  costPrice?: number;
  price?: number;
  soldCount?: number;
};

/** Preserve inventory-only fields when admin product form omits them. */
export function mergeVariantsBySku(
  incoming: VariantRow[],
  existing: VariantRow[],
): VariantRow[] {
  const bySku = new Map(
    existing.filter((v) => v.sku).map((v) => [String(v.sku), v]),
  );

  return incoming.map((row) => {
    const sku = String(row.sku ?? "").trim();
    if (!sku) return row;
    const prev = bySku.get(sku);
    if (!prev) return row;

    return {
      ...row,
      price:
        row.price !== undefined && row.price !== null ?
          row.price
        : prev.price,
      costPrice:
        row.costPrice !== undefined && row.costPrice !== null ?
          row.costPrice
        : prev.costPrice,
      soldCount: prev.soldCount ?? 0,
    };
  });
}

export function mergeVariantsIntoProduct(
  incoming: VariantRow[],
  product: Pick<IProduct, "variants">,
): VariantRow[] {
  return mergeVariantsBySku(incoming, product.variants as VariantRow[]);
}
