import Product from "../../models/Product";
import { cachedFetch } from "../cache/cachedFetch";
import { reconcileProductJson } from "../../types/utils/productStock";
import {
  PREMIUM_PRODUCT_CACHE_TTL,
  PREMIUM_PRODUCT_SELECT,
  PREMIUM_QUERY_MAX_MS,
  PREMIUM_CACHE_SHAPE_VERSION,
} from "../../constants/premiumQuery";

function normalizeProducts(products: Record<string, unknown>[]) {
  return products.map((p) =>
    reconcileProductJson(p as Parameters<typeof reconcileProductJson>[0]),
  );
}

function buildPremiumFilter(search?: string, audience?: string): Record<string, unknown> {
  const filter: Record<string, unknown> = { isPremium: true, isActive: true };
  if (audience && audience.toLowerCase() !== "all") {
    filter.audience = audience.toLowerCase();
  }
  if (search?.trim()) {
    filter.$text = { $search: search.trim() };
  }
  return filter;
}

export async function discoverPremiumProducts(query: Record<string, string>) {
  const { search, page = "1", limit: limitStr = "24", audience } = query;
  const limit = Math.min(Math.max(1, parseInt(limitStr, 10)), 60);
  const pageNum = Math.max(1, parseInt(page, 10));
  const skip = (pageNum - 1) * limit;
  const filter = buildPremiumFilter(search, audience);

  const cacheKey = `cache:premium:products:env:v${PREMIUM_CACHE_SHAPE_VERSION}:${JSON.stringify({ search, page: pageNum, limit, audience })}`;

  const cached = await cachedFetch({
    key: cacheKey,
    softTtlSec: PREMIUM_PRODUCT_CACHE_TTL,
    hardTtlSec: Math.max(
      PREMIUM_PRODUCT_CACHE_TTL * 3,
      PREMIUM_PRODUCT_CACHE_TTL + 60,
    ),
    fetchFresh: async () => {
      const [products, total] = await Promise.all([
        Product.find(filter)
          .select(PREMIUM_PRODUCT_SELECT)
          .sort({ sortOrderPremium: 1, createdAt: -1 })
          .skip(skip)
          .limit(limit)
          .lean()
          .maxTimeMS(PREMIUM_QUERY_MAX_MS),
        Product.countDocuments(filter).maxTimeMS(PREMIUM_QUERY_MAX_MS),
      ]);
      return {
        products: normalizeProducts(products as Record<string, unknown>[]),
        total,
      };
    },
  });

  const loaded = skip + cached.products.length;
  return {
    products: cached.products,
    page: pageNum,
    limit,
    total: cached.total,
    hasNextPage: cached.products.length > 0 && loaded < cached.total,
  };
}

export async function getPremiumProductBySlug(slug: string) {
  const safe = String(slug || "").trim().toLowerCase();
  if (!safe) return null;

  const cacheKey = `cache:premium:product:env:v${PREMIUM_CACHE_SHAPE_VERSION}:${safe}`;

  const cached = await cachedFetch({
    key: cacheKey,
    softTtlSec: PREMIUM_PRODUCT_CACHE_TTL,
    hardTtlSec: Math.max(
      PREMIUM_PRODUCT_CACHE_TTL * 3,
      PREMIUM_PRODUCT_CACHE_TTL + 60,
    ),
    fetchFresh: async () => {
      const product = await Product.findOne({
        isPremium: true,
        isActive: true,
        $or: [{ premiumSlug: safe }, { slug: safe }],
      })
        .select(PREMIUM_PRODUCT_SELECT)
        .lean()
        .maxTimeMS(PREMIUM_QUERY_MAX_MS);

      if (!product) {
        return null;
      }

      return reconcileProductJson(
        product as Parameters<typeof reconcileProductJson>[0],
      );
    },
  });

  return cached;
}

export function invalidatePremiumProductCache(): void {
  import("../cacheService").then(({ clearCachePattern }) => {
    clearCachePattern("cache:premium:*").catch(() => {});
  });
}
