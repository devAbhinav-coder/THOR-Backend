import { decodeHtmlEntities } from "./decodeHtmlEntities";

/** Display label aligned with analytics category buckets (shop + Premium). */
export function formatProductCatalogLabel(input: {
  category?: string | null;
  subcategory?: string | null;
  isPremium?: boolean | null;
}): string {
  const baseCat = decodeHtmlEntities(
    String(input.category || "Uncategorized").trim(),
  );
  const sub = decodeHtmlEntities(String(input.subcategory || "").trim());
  const isPrem = input.isPremium === true;
  if (isPrem) {
    return sub ? `Premium / ${baseCat} / ${sub}` : `Premium / ${baseCat}`;
  }
  return sub ? `${baseCat} / ${sub}` : baseCat;
}
