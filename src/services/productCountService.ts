import mongoose from "mongoose";
import Product from "../models/Product";
import {
  countCacheKey,
  getProductCacheVersion,
} from "./productCacheService";
import { cachedFetch } from "./cache/cachedFetch";

const COUNT_SOFT_TTL_SEC = 60;
const COUNT_HARD_TTL_SEC = 180;
const COUNT_MAX_TIME_MS = 3000;

async function countProductsFromDb(
  filter: Record<string, unknown>,
): Promise<number> {
  const useEstimate =
    process.env.USE_ESTIMATED_PRODUCT_COUNT === "true" &&
    Object.keys(filter).length <= 3 &&
    filter.isActive === true;

  if (useEstimate) {
    try {
      return await Product.estimatedDocumentCount();
    } catch {
      return Product.countDocuments(filter).maxTimeMS(COUNT_MAX_TIME_MS);
    }
  }
  return Product.countDocuments(filter).maxTimeMS(COUNT_MAX_TIME_MS);
}

/**
 * Cached document count. For very large catalogs set USE_ESTIMATED_PRODUCT_COUNT=true
 * on broad filters (storefront base only).
 */
export async function getCachedProductCount(
  filter: Record<string, unknown>,
): Promise<number> {
  const version = await getProductCacheVersion();
  const key = countCacheKey(version, filter);

  return cachedFetch({
    key,
    softTtlSec: COUNT_SOFT_TTL_SEC,
    hardTtlSec: COUNT_HARD_TTL_SEC,
    fetchFresh: () => countProductsFromDb(filter),
  });
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
