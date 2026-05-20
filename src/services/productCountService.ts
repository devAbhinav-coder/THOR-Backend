import mongoose from "mongoose";
import Product from "../models/Product";
import { getCache, setCache } from "./cacheService";
import {
  countCacheKey,
  getProductCacheVersion,
} from "./productCacheService";

const COUNT_TTL_SEC = 60;
const COUNT_MAX_TIME_MS = 3000;

/**
 * Cached document count. For very large catalogs set USE_ESTIMATED_PRODUCT_COUNT=true
 * on broad filters (storefront base only).
 */
export async function getCachedProductCount(
  filter: Record<string, unknown>,
): Promise<number> {
  const version = await getProductCacheVersion();
  const key = countCacheKey(version, filter);
  const cached = await getCache<number>(key);
  if (cached !== null && Number.isFinite(cached)) return cached;

  let count: number;
  const useEstimate =
    process.env.USE_ESTIMATED_PRODUCT_COUNT === "true" &&
    Object.keys(filter).length <= 3 &&
    filter.isActive === true;

  if (useEstimate) {
    try {
      const est = await Product.estimatedDocumentCount();
      count = est;
    } catch {
      count = await Product.countDocuments(filter).maxTimeMS(COUNT_MAX_TIME_MS);
    }
  } else {
    count = await Product.countDocuments(filter).maxTimeMS(COUNT_MAX_TIME_MS);
  }

  setCache(key, count, COUNT_TTL_SEC).catch(() => {});
  return count;
}

export function parseExcludeObjectIds(ids: string[]): mongoose.Types.ObjectId[] {
  return ids.reduce<mongoose.Types.ObjectId[]>((acc, id) => {
    try {
      acc.push(new mongoose.Types.ObjectId(id));
    } catch {
      /* skip invalid */
    }
    return acc;
  }, []);
}
