/** Tag on the internal Product used for manual admin offline line items (hidden from storefront). */
export const OFFLINE_MANUAL_PRODUCT_TAG = '__system_offline_line__';

/** Single variant SKU on the offline manual placeholder product. */
export const OFFLINE_MANUAL_VARIANT_SKU = 'SYS-OFFLINE-MANUAL';

/** Legacy Unsplash placeholder — must not appear on order lines or in catalog. */
export const OFFLINE_MANUAL_LEGACY_PLACEHOLDER_URL =
  'https://images.unsplash.com/photo-1558618666-fcd25c85cd64?w=400&h=400&fit=crop';

/**
 * Same-origin fashion placeholder (served from frontend /public).
 * Stored on orders so Mongo `image` required validation passes.
 */
export const OFFLINE_MANUAL_LINE_PLACEHOLDER_PATH =
  '/images/offline-line-placeholder.svg';

/** @deprecated External Unsplash — replaced by local SVG; kept for backfill detection. */
export const OFFLINE_MANUAL_LINE_PLACEHOLDER_URL_LEGACY =
  'https://images.unsplash.com/photo-1586790170083-2f9ceadc966d?w=800&h=800&fit=crop&q=85';

export function getOfflineManualLinePlaceholderUrl(): string {
  const base = (
    process.env.FRONTEND_URL ||
    process.env.PUBLIC_SITE_URL ||
    'http://localhost:3000'
  ).replace(/\/$/, '');
  return `${base}${OFFLINE_MANUAL_LINE_PLACEHOLDER_PATH}`;
}

/** Neutral placeholder for the hidden system product only (Mongo requires ≥1 image). Never used on order lines. */
export const OFFLINE_MANUAL_SYSTEM_PRODUCT_IMAGE = {
  url: `data:image/svg+xml,${encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400" viewBox="0 0 400 400"><rect width="400" height="400" fill="#f3f4f6"/><rect x="130" y="120" width="140" height="160" rx="8" fill="#e5e7eb"/><path d="M170 200h60M200 170v60" stroke="#9ca3af" stroke-width="6" stroke-linecap="round"/></svg>',
  )}`,
  publicId: 'offline-system/neutral-placeholder',
};

/** Mongo filter: exclude the internal offline placeholder product. */
export function excludeOfflineManualProductFilter(): Record<string, unknown> {
  return { tags: { $nin: [OFFLINE_MANUAL_PRODUCT_TAG] } };
}

/** Standard match for real shop inventory (active catalog products only). */
export function catalogInventoryProductMatch(
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return { isActive: true, ...excludeOfflineManualProductFilter(), ...extra };
}

/** Shop/admin product lists — never include the offline system placeholder. */
export function shopCatalogBaseFilter(
  adminScope: boolean,
): Record<string, unknown> {
  return {
    ...(adminScope ?
      {}
    : {
        isActive: true,
        // Premium Edit lives on /premium only — never in shop catalog.
        isPremium: { $ne: true },
      }),
    ...excludeOfflineManualProductFilter(),
    // Admin lists include Premium Edit SKUs (badge/filter in UI).
    // Storefront never lists Gifting or Premium categories.
    category: {
      $nin: adminScope ? ["Gifting"] : ["Gifting", "Premium"],
    },
  };
}

/**
 * List base filter with optional Premium Edit scope.
 * When `isPremium === true`, do not apply shop `category: $nin Premium`
 * (premium products are stored as category "Premium").
 */
export function resolveProductListBaseFilter(opts: {
  adminScope: boolean;
  isPremium?: boolean;
}): Record<string, unknown> {
  if (opts.isPremium === true) {
    return {
      ...excludeOfflineManualProductFilter(),
      isPremium: true,
      ...(opts.adminScope ? {} : { isActive: true }),
    };
  }

  if (opts.isPremium === false) {
    return {
      ...excludeOfflineManualProductFilter(),
      isPremium: { $ne: true },
      category: { $nin: ["Gifting", "Premium"] },
      ...(opts.adminScope ? {} : { isActive: true }),
    };
  }

  return shopCatalogBaseFilter(opts.adminScope);
}

export function isLegacyOfflineManualPlaceholderImage(url: unknown): boolean {
  if (typeof url !== 'string' || !url.trim()) return false;
  const u = url.trim();
  return (
    u === OFFLINE_MANUAL_LEGACY_PLACEHOLDER_URL ||
    u.includes('photo-1558618666-fcd25c85cd64') ||
    u === OFFLINE_MANUAL_LINE_PLACEHOLDER_URL_LEGACY ||
    u.includes('photo-1586790170083-2f9ceadc966d')
  );
}

/** Category image when present; otherwise the shared fashion placeholder (absolute site URL). */
export function resolveOfflineManualLineImage(
  categoryImage?: string | null,
): string {
  const cat =
    typeof categoryImage === 'string' ? categoryImage.trim() : '';
  if (cat && !isLegacyOfflineManualPlaceholderImage(cat)) return cat;
  return getOfflineManualLinePlaceholderUrl();
}
