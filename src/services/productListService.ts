import mongoose from "mongoose";
import Product from "../models/Product";
import APIFeatures from "../types/utils/apiFeatures";
import { IProduct } from "../types";
import { OFFLINE_MANUAL_PRODUCT_TAG } from "../constants/offlineOrder";
import { LISTING_PROJECTION } from "../constants/productListing";
import { advancedSearchService } from "./advancedSearchService";
import {
  mapSortToAdvanced,
  normalizeSearchQuery,
  ParsedProductListQuery,
} from "./productQueryParser";
import {
  getCachedProductCount,
  parseExcludeObjectIds,
} from "./productCountService";
import {
  filtersCacheKey,
  getProductCacheVersion,
  randomPoolCountKey,
} from "./productCacheService";
import { getCache, setCache } from "./cacheService";

const RANDOM_COUNT_TTL = 300;

/** Shop catalog excludes gifting; admin shop catalog does too unless `category` overrides below. */
export function storefrontBaseFilter(
  adminScope: boolean,
): Record<string, unknown> {
  if (adminScope) {
    return { category: { $ne: "Gifting" } };
  }
  return {
    isActive: true,
    category: { $ne: "Gifting" },
    tags: { $nin: [OFFLINE_MANUAL_PRODUCT_TAG] },
  };
}

export type ProductListResult = {
  products: Record<string, unknown>[];
  page: number;
  limit: number;
  total: number;
  hasNextPage?: boolean;
  searchMethod?: string;
};

export async function listRandomProducts(
  parsed: ParsedProductListQuery,
): Promise<ProductListResult> {
  const baseFilter: Record<string, unknown> = {
    ...storefrontBaseFilter(parsed.adminScope),
  };

  const excludeIds = parseExcludeObjectIds(parsed.excludeIds);
  if (excludeIds.length) {
    baseFilter._id = { $nin: excludeIds };
  }

  /** Count pool only on the first random page — later pages use batch size (much faster). */
  let poolSize = 0;
  if (excludeIds.length === 0) {
    const version = await getProductCacheVersion();
    const countKey = randomPoolCountKey(version, "excl0");
    const cached = await getCache<number>(countKey);
    if (cached !== null && Number.isFinite(cached)) {
      poolSize = cached;
    } else {
      poolSize = await getCachedProductCount(baseFilter);
      setCache(countKey, poolSize, RANDOM_COUNT_TTL).catch(() => {});
    }
  }

  const products = await Product.aggregate<Record<string, unknown>>([
    { $match: baseFilter },
    { $sample: { size: parsed.limit } },
    {
      $project: {
        name: 1,
        slug: 1,
        price: 1,
        comparePrice: 1,
        images: 1,
        ratings: 1,
        category: 1,
        fabric: 1,
        isFeatured: 1,
        isActive: 1,
        totalStock: 1,
        variants: 1,
        tags: 1,
        isGiftable: 1,
        isCustomizable: 1,
        customFields: 1,
      },
    },
  ]).option({ maxTimeMS: 4000 });

  const loaded = excludeIds.length + products.length;
  const hasNextPage =
    products.length > 0 &&
    (excludeIds.length === 0 ?
      loaded < poolSize && products.length >= parsed.limit
    : products.length >= parsed.limit);

  return {
    products,
    page: 1,
    limit: parsed.limit,
    total: poolSize || loaded,
    hasNextPage,
  };
}

export async function listProductsViaApiFeatures(
  parsed: ParsedProductListQuery,
  reqQuery: Record<string, string | undefined>,
): Promise<ProductListResult> {
  const ratingFilter: Record<string, unknown> = {};
  if (parsed.minRating !== undefined) {
    ratingFilter["ratings.average"] = { $gte: parsed.minRating };
  }

  const categoryBase: Record<string, unknown> = {
    ...storefrontBaseFilter(parsed.adminScope),
    ...(parsed.categories.length > 0 ?
      { category: { $in: parsed.categories } }
    : {}),
    ...(parsed.fabrics.length > 0 ? { fabric: { $in: parsed.fabrics } } : {}),
    ...(parsed.isFeatured === true ? { isFeatured: true } : {}),
    ...(parsed.isFeatured === false ? { isFeatured: false } : {}),
    ...(parsed.adminScope && parsed.isActive === true ?
      { isActive: true }
    : {}),
    ...(parsed.adminScope && parsed.isActive === false ?
      { isActive: false }
    : {}),
    ...ratingFilter,
  };

  const queryString: Record<string, string | undefined> = {
    page: String(parsed.page),
    limit: String(parsed.limit),
    sort: parsed.sort === "featured" ? "-isFeatured,-createdAt" : parsed.sort,
  };
  if (parsed.search) queryString.search = parsed.search;
  if (parsed.minPrice !== undefined) {
    queryString["price[gte]"] = String(parsed.minPrice);
  }
  if (parsed.maxPrice !== undefined) {
    queryString["price[lte]"] = String(parsed.maxPrice);
  }

  const features = new APIFeatures<IProduct>(
    Product.find(categoryBase),
    queryString,
  )
    .filter()
    .search(["name", "description", "tags", "category", "fabric"])
    .sort()
    .paginate();

  const mongoFilter = {
    ...categoryBase,
    ...features.getMongoFilter(),
  };

  const [products, total] = await Promise.all([
    features.query
      .select(LISTING_PROJECTION)
      .lean<Record<string, unknown>[]>()
      .maxTimeMS(5000),
    getCachedProductCount(mongoFilter),
  ]);

  const page = features.getPage();
  const limit = features.getLimit();
  const skip = (page - 1) * limit;
  const hasNextPage = products.length > 0 && skip + products.length < total;

  return {
    products,
    page,
    limit,
    total,
    hasNextPage,
    searchMethod: parsed.search ? "text" : "basic",
  };
}

export async function listProductsViaAdvancedSearch(
  parsed: ParsedProductListQuery,
): Promise<ProductListResult> {
  const { sortBy, sortOrder } = mapSortToAdvanced(parsed.sort);

  const searchResult = await advancedSearchService.searchProducts({
    query: parsed.search,
    sortBy,
    sortOrder,
    page: parsed.page,
    limit: parsed.limit,
    categories: parsed.categories,
    fabrics: parsed.fabrics,
    minPrice: parsed.minPrice,
    maxPrice: parsed.maxPrice,
    minRating: parsed.minRating,
    isFeatured: parsed.isFeatured,
    isActive: parsed.isActive,
    adminScope: parsed.adminScope,
    useCache: true,
  });

  return {
    products: searchResult.products,
    page: searchResult.page,
    limit: searchResult.limit,
    total: searchResult.total,
    hasNextPage: searchResult.page < searchResult.totalPages,
    searchMethod: searchResult.searchMethod,
  };
}

export async function listProducts(
  parsed: ParsedProductListQuery,
  reqQuery: Record<string, string | undefined>,
): Promise<ProductListResult> {
  if (parsed.isRandom) {
    return listRandomProducts(parsed);
  }

  if (parsed.search.trim()) {
    return listProductsViaAdvancedSearch(parsed);
  }

  return listProductsViaApiFeatures(parsed, reqQuery);
}
