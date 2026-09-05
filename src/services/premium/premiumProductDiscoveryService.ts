import Product from "../../models/Product";
import { getCache, setCache } from "../cacheService";
import { reconcileProductJson } from "../../types/utils/productStock";
import {
  PREMIUM_PRODUCT_CACHE_TTL,
  PREMIUM_PRODUCT_SELECT,
  PREMIUM_QUERY_MAX_MS,
} from "../../constants/premiumQuery";

function normalizeProducts(products: Record<string, unknown>[]) {
  return products.map((p) =>
    reconcileProductJson(p as Parameters<typeof reconcileProductJson>[0]),
  );
}

function buildPremiumFilter(search?: string): Record<string, unknown> {
  const filter: Record<string, unknown> = { isPremium: true, isActive: true };
  if (search?.trim()) {
    filter.$text = { $search: search.trim() };
  }
  return filter;
}

export async function discoverPremiumProducts(query: Record<string, string>) {
  const { search, page = "1", limit: limitStr = "24" } = query;
  const limit = Math.min(Math.max(1, parseInt(limitStr, 10)), 60);
  const pageNum = Math.max(1, parseInt(page, 10));
  const skip = (pageNum - 1) * limit;
  const filter = buildPremiumFilter(search);

  const cacheKey = `cache:premium:products:v1:${JSON.stringify({ search, page: pageNum, limit })}`;
  const cached = await getCache<{
    products: Record<string, unknown>[];
    total: number;
  }>(cacheKey);

  if (cached) {
    const loaded = skip + cached.products.length;
    return {
      products: normalizeProducts(cached.products),
      page: pageNum,
      limit,
      total: cached.total,
      hasNextPage: cached.products.length > 0 && loaded < cached.total,
    };
  }

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

  const normalized = normalizeProducts(products as Record<string, unknown>[]);
  setCache(cacheKey, { products: normalized, total }, PREMIUM_PRODUCT_CACHE_TTL).catch(
    () => {},
  );

  const loaded = skip + normalized.length;
  return {
    products: normalized,
    page: pageNum,
    limit,
    total,
    hasNextPage: normalized.length > 0 && loaded < total,
  };
}

export async function getPremiumProductBySlug(slug: string) {
  const safe = String(slug || "").trim().toLowerCase();
  if (!safe) return null;

  const cacheKey = `cache:premium:product:v1:${safe}`;
  const cached = await getCache<Record<string, unknown>>(cacheKey);
  if (cached) {
    return reconcileProductJson(
      cached as Parameters<typeof reconcileProductJson>[0],
    );
  }

  const product = await Product.findOne({
    isPremium: true,
    isActive: true,
    $or: [{ premiumSlug: safe }, { slug: safe }],
  })
    .select(PREMIUM_PRODUCT_SELECT)
    .lean()
    .maxTimeMS(PREMIUM_QUERY_MAX_MS);

  if (!product) return null;

  const normalized = reconcileProductJson(
    product as Parameters<typeof reconcileProductJson>[0],
  );
  setCache(cacheKey, normalized, PREMIUM_PRODUCT_CACHE_TTL).catch(() => {});
  return normalized;
}

export function invalidatePremiumProductCache(): void {
  import("../cacheService").then(({ clearCachePattern }) => {
    clearCachePattern("cache:premium:*").catch(() => {});
  });
}
