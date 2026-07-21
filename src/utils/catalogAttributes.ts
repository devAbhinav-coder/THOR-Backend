/** Shared catalog attribute helpers — colors/fabrics for filters + save. */

export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Space/punct-insensitive key: "Off White" === "Offwhite" === "off-white". */
export function catalogMatchKey(value: string | undefined | null): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

export function toTitleCaseLabel(value: string): string {
  return String(value ?? "")
    .trim()
    .replace(/[\s/_-]+/g, " ")
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Prefer Title Case with spaces over ALL CAPS / lowercase / jammed words. */
export function scoreCatalogLabel(label: string): number {
  const trimmed = String(label || "").trim();
  if (!trimmed) return -Infinity;
  let score = 0;
  const hasLower = /[a-z]/.test(trimmed);
  const hasUpper = /[A-Z]/.test(trimmed);
  if (hasLower && hasUpper) score += 12;
  if (/\s/.test(trimmed)) score += 8;
  if (trimmed === trimmed.toUpperCase() && trimmed.length > 2) score -= 8;
  if (trimmed === trimmed.toLowerCase()) score -= 3;
  score += Math.min(trimmed.length, 24);
  return score;
}

export function pickCanonicalLabel(candidates: string[]): string {
  const cleaned = candidates
    .map((c) => String(c || "").trim())
    .filter(Boolean);
  if (!cleaned.length) return "";

  // Prefer a spaced form when any candidate has spaces (Off White > Offwhite).
  const spaced = cleaned.filter((c) => /\s/.test(c));
  const pool = spaced.length ? spaced : cleaned;

  let best = pool[0]!;
  let bestScore = scoreCatalogLabel(best);
  for (let i = 1; i < pool.length; i++) {
    const next = pool[i]!;
    const score = scoreCatalogLabel(next);
    if (
      score > bestScore ||
      (score === bestScore && next.localeCompare(best) < 0)
    ) {
      best = next;
      bestScore = score;
    }
  }

  // Always emit consistent Title Case so "Mustard yellow" / "Mustard Yellow" unify.
  const titled = toTitleCaseLabel(best);
  return catalogMatchKey(titled) === catalogMatchKey(best) ? titled : best;
}

/** Dedupe labels that only differ by case / spacing / punctuation. */
export function dedupeCatalogLabels(values: string[]): string[] {
  const byKey = new Map<string, string[]>();
  for (const value of values) {
    const trimmed = String(value || "").trim();
    if (!trimmed) continue;
    const key = catalogMatchKey(trimmed);
    if (!key) continue;
    const list = byKey.get(key) ?? [];
    list.push(trimmed);
    byKey.set(key, list);
  }
  return [...byKey.values()]
    .map(pickCanonicalLabel)
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
}

/**
 * Flexible color match: "Off White" matches "Offwhite", "off-white", etc.
 * Keeps start/end anchors so "Red" does not match "Red Wine" incorrectly via substring.
 */
export function colorFlexibleRegex(color: string): RegExp {
  const key = catalogMatchKey(color);
  if (!key) return /^$/;
  const pattern = key
    .split("")
    .map((ch) => escapeRegExp(ch))
    .join("[\\s\\-_]*");
  return new RegExp(`^${pattern}$`, "i");
}

export function resolveColorAgainstCatalog(
  input: string,
  catalog: string[] = [],
): string {
  const trimmed = String(input || "").trim();
  if (!trimmed) return "";
  const key = catalogMatchKey(trimmed);
  if (!key) return "";
  for (const existing of catalog) {
    if (catalogMatchKey(existing) === key) {
      return String(existing).trim();
    }
  }
  return toTitleCaseLabel(trimmed);
}

export function canonicalizeVariantColors<T>(
  variants: T[] | undefined,
  catalog: string[] = [],
): T[] {
  if (!Array.isArray(variants)) return [];
  return variants.map((v) => {
    const raw = String((v as { color?: unknown }).color ?? "").trim();
    if (!raw) return v;
    return {
      ...(v as object),
      color: resolveColorAgainstCatalog(raw, catalog),
    } as T;
  });
}
