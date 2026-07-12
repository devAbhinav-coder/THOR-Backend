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

export function mergeOccasionOptions(fromProducts: string[] = []): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of [...PRODUCT_OCCASIONS, ...fromProducts]) {
    const trimmed = String(value || '').trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(trimmed);
  }
  return out.sort((a, b) => a.localeCompare(b));
}
