import mongoose from "mongoose";
import Product from "../../models/Product";
import { productRepository } from "../../repositories/productRepository";
import { getCache, setCache } from "../cacheService";
import { redisConnection, redisEnabled } from "../../config/redis";
import { reconcileProductJson } from "../../types/utils/productStock";
import {
  GIFTABLE_PRODUCT_SELECT,
  GIFTING_PRODUCT_CACHE_TTL,
  GIFTING_QUERY_MAX_MS,
  GIFTING_RANDOM_POOL_TTL,
} from "../../constants/giftingQuery";
import { recordGiftingTiming } from "./giftingMetricsService";

const RANDOM_POOL_KEY = "gifting:random:product_ids";
const RANDOM_POOL_MAX = Number(process.env.GIFTING_RANDOM_POOL_SIZE || 400);

function escapeRegex(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildGiftableFilter(params: {
  giftOccasion?: string;
  category?: string;
  search?: string;
}): Record<string, unknown> {
  const filter: Record<string, unknown> = { isGiftable: true, isActive: true };
  if (params.giftOccasion)
    filter.occasions = { $in: [params.giftOccasion] };
  if (params.category) filter.category = params.category;
  if (params.search?.trim()) {
    filter.$text = { $search: params.search.trim() };
  }
  return filter;
}

function normalizeProducts(products: Record<string, unknown>[]) {
  return products.map((p) =>
    reconcileProductJson(p as Parameters<typeof reconcileProductJson>[0]),
  );
}

async function refreshRandomPool(
  filter: Record<string, unknown>,
): Promise<string[]> {
  const ids = await Product.find(filter)
    .select("_id")
    .limit(RANDOM_POOL_MAX)
    .lean()
    .maxTimeMS(GIFTING_QUERY_MAX_MS);
  const idStrings = ids.map((r) => String(r._id));
  if (redisEnabled && idStrings.length > 0) {
    const conn = redisConnection as import("ioredis").default;
    const pipe = conn.pipeline();
    pipe.del(RANDOM_POOL_KEY);
    if (idStrings.length > 0) pipe.sadd(RANDOM_POOL_KEY, ...idStrings);
    pipe.expire(RANDOM_POOL_KEY, GIFTING_RANDOM_POOL_TTL);
    pipe.exec().catch(() => {});
  }
  return idStrings;
}

function pickRandomIds(
  pool: string[],
  limit: number,
  excludeIds: string[],
): string[] {
  const exclude = new Set(excludeIds);
  const candidates = pool.filter((id) => !exclude.has(id));
  const arr = [...candidates];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j]!, arr[i]!];
  }
  return arr.slice(0, limit);
}

/**
 * Random giftable products without $sample — uses Redis pool + indexed random skip fallback.
 */
async function findRandomGiftable(
  filter: Record<string, unknown>,
  limit: number,
  excludeIds: mongoose.Types.ObjectId[],
): Promise<{ products: Record<string, unknown>[]; total: number }> {
  const started = Date.now();
  const randomFilter = {
    ...filter,
    ...(excludeIds.length && { _id: { $nin: excludeIds } }),
  };

  const skipCount = excludeIds.length > 0;
  const total =
    skipCount ? 0 : (
      await Product.countDocuments(randomFilter).maxTimeMS(GIFTING_QUERY_MAX_MS)
    );
  if (!skipCount && total === 0) {
    return { products: [], total: 0 };
  }

  let pickedIds: string[] = [];

  if (redisEnabled) {
    const conn = redisConnection as import("ioredis").default;
    const excludeSet = new Set(excludeIds.map(String));
    let pool = await conn.smembers(RANDOM_POOL_KEY);
    let available = pool.filter((id) => !excludeSet.has(id)).length;
    if (available < limit) {
      pool = await refreshRandomPool(randomFilter);
      available = pool.filter((id) => !excludeSet.has(id)).length;
    }
    if (available > 0) {
      pickedIds = pickRandomIds(pool, limit, excludeIds.map(String));
    }
  }

  if (pickedIds.length < limit) {
    const remaining = total - limit;
    const skip =
      remaining > 0 ? Math.floor(Math.random() * (remaining + 1)) : 0;
    const fallback = await productRepository.findGiftable(
      randomFilter,
      skip,
      limit,
    );
    const fallbackIds = fallback.map((p) =>
      String((p as { _id: unknown })._id),
    );
    pickedIds = [...new Set([...pickedIds, ...fallbackIds])].slice(0, limit);
  }

  const products = await Product.find({ _id: { $in: pickedIds } })
    .select(GIFTABLE_PRODUCT_SELECT)
    .lean()
    .maxTimeMS(GIFTING_QUERY_MAX_MS);

  recordGiftingTiming("gifting.products.random_ms", Date.now() - started, {
    count: products.length,
  });
  return {
    products: normalizeProducts(products as Record<string, unknown>[]),
    total,
  };
}

export async function discoverGiftableProducts(query: Record<string, string>) {
  const {
    giftOccasion,
    category,
    search,
    isRandom,
    excludeIds: excludeIdsStr,
    page = "1",
    limit: limitStr = "20",
  } = query;

  const limit = Math.min(Math.max(1, parseInt(limitStr, 10)), 60);
  const filter = buildGiftableFilter({ giftOccasion, category, search });

  if (isRandom === "true") {
    const excludeIds = (excludeIdsStr || "")
      .split(",")
      .filter(Boolean)
      .reduce<mongoose.Types.ObjectId[]>((acc, id) => {
        try {
          acc.push(new mongoose.Types.ObjectId(id));
        } catch {
          /* skip invalid */
        }
        return acc;
      }, []);

    const { products, total } = await findRandomGiftable(
      filter,
      limit,
      excludeIds,
    );
    const loaded = excludeIds.length + products.length;
    const hasNextPage =
      products.length > 0 &&
      (excludeIds.length === 0 ?
        loaded < total && products.length >= limit
      : products.length >= limit);
    return { products, page: 1, limit, total: total || loaded, hasNextPage };
  }

  const pageNum = Math.max(1, parseInt(page, 10));
  const skip = (pageNum - 1) * limit;
  const cacheKey = `cache:gifting:products:v3:${JSON.stringify({ giftOccasion, category, search, page: pageNum, limit })}`;

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
    productRepository.findGiftable(filter, skip, limit),
    Product.countDocuments(filter).maxTimeMS(GIFTING_QUERY_MAX_MS),
  ]);

  const normalized = normalizeProducts(products as Record<string, unknown>[]);
  setCache(
    cacheKey,
    { products: normalized, total },
    GIFTING_PRODUCT_CACHE_TTL,
  ).catch(() => {});

  const loaded = skip + normalized.length;
  const hasNextPage = normalized.length > 0 && loaded < total;

  return { products: normalized, page: pageNum, limit, total, hasNextPage };
}

export async function getGiftCategories() {
  const CategoryModel = (await import("../../models/Category")).default;
  return CategoryModel.find({ isGiftCategory: true, isActive: true })
    .select(
      "name slug image description subcategories isActive isGiftCategory giftType minOrderQty",
    )
    .lean()
    .maxTimeMS(GIFTING_QUERY_MAX_MS);
}

export function invalidateGiftingProductCache(): void {
  // Namespace bump could be added; pattern clear is async-safe for low volume
  import("../cacheService").then(({ clearCachePattern }) => {
    clearCachePattern("cache:gifting:products:*").catch(() => {});
  });
}
