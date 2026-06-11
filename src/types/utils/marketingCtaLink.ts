const frontendUrl = (process.env.FRONTEND_URL || 'https://thehouseofrani.com').replace(/\/$/, '');

/** Accepts `https://...` or site paths like `/shop`. */
export function isValidMarketingCtaLink(raw: string | undefined): boolean {
  if (!raw?.trim()) return true;
  const v = raw.trim();
  if (/^https:\/\/.+/i.test(v)) return true;
  if (v.startsWith('/') && !v.startsWith('//')) return true;
  return false;
}

export function normalizeMarketingCtaLink(raw: string | undefined): string | undefined {
  if (!raw?.trim()) return undefined;
  const v = raw.trim();
  if (/^https:\/\//i.test(v)) return v;
  if (v.startsWith('/') && !v.startsWith('//')) {
    return `${frontendUrl}${v}`;
  }
  return undefined;
}
