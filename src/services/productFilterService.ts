import Product from '../models/Product';
import { getCache, setCache } from './cacheService';
import { filtersCacheKey, getProductCacheVersion } from './productCacheService';
import { OFFLINE_MANUAL_PRODUCT_TAG } from '../constants/offlineOrder';
import mongoose from 'mongoose';

const FILTERS_CACHE_TTL = 300;

export async function getFilterOptionsForCategory(categoryId: string, subcategoryId?: string) {
  const v = await getProductCacheVersion();
  const cacheKey = filtersCacheKey(v, `${categoryId}-${subcategoryId || 'all'}`);
  const cached = await getCache<{
    categories: string[];
    fabrics: string[];
    subcategories: string[];
    tags: string[];
    priceRange: { minPrice: number; maxPrice: number };
  }>(cacheKey);
  if (cached) return cached;

  const shopMatch: Record<string, unknown> = {
    isActive: true,
    category: { $ne: 'Gifting' },
    tags: { $nin: [OFFLINE_MANUAL_PRODUCT_TAG] },
  };

  if (categoryId) {
    shopMatch.categoryId = new mongoose.Types.ObjectId(categoryId);
  }
  if (subcategoryId) {
    shopMatch.subcategoryId = new mongoose.Types.ObjectId(subcategoryId);
  }

  const [facet] = await Product.aggregate<{
    allFabrics: { fabrics: string[] }[];
    allTags: { tags: string[] }[];
    scopedPrice: {
      minPrice: number;
      maxPrice: number;
    }[];
  }>([
    {
      $facet: {
        allFabrics: [
          { $match: shopMatch },
          {
            $group: {
              _id: null,
              fabrics: { $addToSet: '$fabric' },
            },
          },
        ],
        allTags: [
          { $match: shopMatch },
          { $unwind: '$tags' },
          {
            $group: {
              _id: null,
              tags: { $addToSet: '$tags' },
            },
          },
        ],
        scopedPrice: [
          { $match: shopMatch },
          {
            $group: {
              _id: null,
              minPrice: { $min: '$price' },
              maxPrice: { $max: '$price' },
            },
          },
        ],
      },
    },
  ]).option({ maxTimeMS: 4000 });

  const allFabrics = facet?.allFabrics?.[0];
  const allTags = facet?.allTags?.[0];
  const scopedPrice = facet?.scopedPrice?.[0];

  const result = {
    categories: [], // Not needed for sub-pages typically, but keeping interface
    fabrics: (allFabrics?.fabrics ?? []).filter(Boolean).sort() as string[],
    subcategories: [], // Handled by collection hierarchy now
    tags: (allTags?.tags ?? []).filter(Boolean).sort() as string[],
    priceRange: {
      minPrice: scopedPrice?.minPrice ?? 0,
      maxPrice: scopedPrice?.maxPrice ?? 100000,
    },
  };

  setCache(cacheKey, result, FILTERS_CACHE_TTL).catch(() => {});
  return result;
}
