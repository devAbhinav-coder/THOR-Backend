/** Predefined product occasions — admin form + shop filters. */
export const PRODUCT_OCCASIONS = [
  'Wedding',
  'Bridal',
  'Reception',
  'Festive',
  'Party',
  'Casual',
  'Office / Formal',
  'Daily Wear',
] as const;

export const PRODUCT_FABRICS = [
  'Silk',
  'Cotton',
  'Chiffon',
  'Georgette',
  'Banarasi',
  'Kanjeevaram',
  'Linen',
  'Crepe',
  'Net',
  'Velvet',
  'Jacquard',
  'Chanderi',
  'Other',
] as const;

function mergeCatalogOptions(
  presets: readonly string[],
  fromProducts: string[] = [],
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of [...presets, ...fromProducts]) {
    const trimmed = String(value || '').trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(trimmed);
  }
  return out.sort((a, b) => a.localeCompare(b));
}

export function mergeOccasionOptions(fromProducts: string[] = []): string[] {
  return mergeCatalogOptions(PRODUCT_OCCASIONS, fromProducts);
}

export function mergeFabricOptions(fromProducts: string[] = []): string[] {
  return mergeCatalogOptions(PRODUCT_FABRICS, fromProducts);
}
