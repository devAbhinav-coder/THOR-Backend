import logger from "../types/utils/logger";
import {
  storefrontProductPaths,
  storefrontProductRevalidateSlugs,
  type StorefrontProductLike,
} from "./storefrontPathService";

function getFrontendOrigin(): string | null {
  const raw = (
    process.env.FRONTEND_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    "https://www.thehouseofrani.com"
  ).trim();
  try {
    return new URL(raw).origin;
  } catch {
    return null;
  }
}

type RevalidateOptions = {
  paths?: string[];
  product?: StorefrontProductLike | null;
  /** Refresh sitemap.xml + catalog product list caches. */
  catalog?: boolean;
};

/** Ask Next.js to purge ISR for PDP, sitemap, and catalog tags (fire-and-forget). */
export function notifyStorefrontRevalidate(options: RevalidateOptions): void {
  const secret = process.env.REVALIDATE_SECRET?.trim();
  if (!secret) return;

  const origin = getFrontendOrigin();
  if (!origin) return;

  const paths = new Set<string>(options.paths ?? []);
  if (options.product) {
    for (const p of storefrontProductPaths(options.product)) {
      paths.add(p);
    }
  }

  const productSlugs =
    options.product ? storefrontProductRevalidateSlugs(options.product) : [];
  const tags = productSlugs.map(
    (s) => `product-${s.trim().toLowerCase()}`,
  );

  const body: Record<string, unknown> = {
    secret,
    paths: [...paths],
    tags,
    catalog: options.catalog === true,
  };
  if (productSlugs[0]) body.productSlug = productSlugs[0];

  void fetch(`${origin}/api/revalidate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).then(async (res) => {
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      logger.warn("Storefront revalidate failed", {
        status: res.status,
        body: text.slice(0, 200),
      });
    }
  }).catch((err: unknown) => {
    logger.warn("Storefront revalidate request error", { err });
  });
}

export function notifyStorefrontProductCatalogChange(
  product: StorefrontProductLike,
): void {
  notifyStorefrontRevalidate({ product, catalog: true });
}

/** Category, subcategory, blog, or nav structure — refresh sitemap + collection URLs. */
export function notifyStorefrontCatalogStructureChange(
  paths: string[] = [],
): void {
  notifyStorefrontRevalidate({ paths, catalog: true });
}
