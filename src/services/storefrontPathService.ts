/**
 * Canonical storefront paths for SEO, IndexNow, and Next.js on-demand revalidation.
 */

export type StorefrontProductLike = {
  slug?: string | null;
  premiumSlug?: string | null;
  isPremium?: boolean | null;
  category?: string | null;
};

/** Primary PDP path(s) to ping after catalog changes. */
export function storefrontProductPaths(
  product: StorefrontProductLike,
): string[] {
  const catalogSlug = String(product.slug || "").trim();
  const isPremium = product.isPremium === true;
  const premiumRoute = String(
    product.premiumSlug || product.slug || "",
  ).trim();

  const paths: string[] = [];

  if (isPremium && premiumRoute) {
    paths.push(`/premium/${encodeURIComponent(premiumRoute)}`);
  } else if (catalogSlug) {
    paths.push(`/shop/${encodeURIComponent(catalogSlug)}`);
  } else if (premiumRoute) {
    paths.push(`/premium/${encodeURIComponent(premiumRoute)}`);
  }

  return [...new Set(paths)];
}

/** Slugs used for Next.js `product-{slug}` cache tags. */
export function storefrontProductRevalidateSlugs(
  product: StorefrontProductLike,
): string[] {
  const slugs = new Set<string>();
  const catalogSlug = String(product.slug || "").trim();
  const premiumRoute = String(
    product.premiumSlug || product.slug || "",
  ).trim();
  if (catalogSlug) slugs.add(catalogSlug);
  if (premiumRoute) slugs.add(premiumRoute);
  return [...slugs];
}
