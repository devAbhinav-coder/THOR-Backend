import mongoose from "mongoose";
import Product from "../models/Product";
import APIFeatures from "../types/utils/apiFeatures";
import { IProduct } from "../types";
import { OFFLINE_MANUAL_PRODUCT_TAG } from "../constants/offlineOrder";
import { LISTING_PROJECTION } from "../constants/productListing";
import { advancedSearchService } from "./advancedSearchService";
import {
  normalizeSearchQuery,
  normalizeShopListSort,
  ParsedProductListQuery,
  resolveShopSearchSort,
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
import { buildShopCollectionFilter } from "./shopCollectionFilterService";
import { mergeOnSaleFilter, mergeHasOfferFilter } from "../constants/onSaleFilter";
import { colorFlexibleRegex } from "../utils/catalogAttributes";
import { getActiveSaleCampaigns } from "./sale/saleCacheService";
import { enrichProductsWithSalePricing } from "./sale/saleProductEnrichment";
import { couponValidationService } from "./coupon/couponValidationService";

const RANDOM_COUNT_TTL = 300;

function buildColorMongoFilter(
  colors: string[],
): Record<string, unknown> | null {
  if (!colors.length) return null;
  return {
    "variants.color": { $in: colors.map((c) => colorFlexibleRegex(c)) },
  };
}

function buildFabricMongoFilter(
  fabrics: string[],
): Record<string, unknown> | null {
  if (!fabrics.length) return null;
  return {
    $or: fabrics.map((fabric) => {
      const escaped = fabric.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      return { fabric: new RegExp(`^${escaped}$`, "i") };
    }),
  };
}

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
  searchIntent?: import("./searchQueryParser").ParsedSearchIntent;
};

export async function listRandomProducts(
  parsed: ParsedProductListQuery,
): Promise<ProductListResult> {
  const collectionFilter = await buildShopCollectionFilter(
    parsed.categories,
    parsed.subcategories,
  );

  const colorFilter = buildColorMongoFilter(parsed.colors);
  const fabricFilter = buildFabricMongoFilter(parsed.fabrics);

  const [campaigns, offerScopes] = await Promise.all([
    parsed.onSale === true || !parsed.adminScope ?
      getActiveSaleCampaigns()
    : Promise.resolve([]),
    parsed.hasOffer === true ?
      couponValidationService.getActiveTargetedOfferScopes()
    : Promise.resolve({ categoryIds: [], subcategoryIds: [], productIds: [] }),
  ]);

  let baseFilter: Record<string, unknown> = mergeOnSaleFilter(
    {
      ...storefrontBaseFilter(parsed.adminScope),
      ...(collectionFilter ?? {}),
      ...(parsed.occasions.length > 0 ?
        { occasions: { $in: parsed.occasions } }
      : {}),
      ...(colorFilter ?? {}),
      ...(fabricFilter ?? {}),
    },
    parsed.onSale === true,
    campaigns,
  );
  baseFilter = mergeHasOfferFilter(baseFilter, parsed.hasOffer === true, offerScopes);

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
        categoryId: 1,
        subcategory: 1,
        subcategoryId: 1,
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

  const enriched = enrichProductsWithSalePricing(products, campaigns);

  return {
    products: enriched,
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

  const collectionFilter = await buildShopCollectionFilter(
    parsed.categories,
    parsed.subcategories,
  );

  const colorFilter = buildColorMongoFilter(parsed.colors);
  const fabricFilter = buildFabricMongoFilter(parsed.fabrics);

  const [campaigns, offerScopes] = await Promise.all([
    getActiveSaleCampaigns(),
    parsed.hasOffer === true ?
      couponValidationService.getActiveTargetedOfferScopes()
    : Promise.resolve({ categoryIds: [], subcategoryIds: [], productIds: [] }),
  ]);

  let categoryBase: Record<string, unknown> = mergeOnSaleFilter(
    {
      ...storefrontBaseFilter(parsed.adminScope),
      ...(collectionFilter ?? {}),
      ...(parsed.occasions.length > 0 ?
        { occasions: { $in: parsed.occasions } }
      : {}),
      ...(colorFilter ?? {}),
      ...(fabricFilter ?? {}),
      ...(parsed.isFeatured === true ? { isFeatured: true } : {}),
      ...(parsed.isFeatured === false ? { isFeatured: false } : {}),
      ...(parsed.adminScope && parsed.isActive === true ?
        { isActive: true }
      : {}),
      ...(parsed.adminScope && parsed.isActive === false ?
        { isActive: false }
      : {}),
      ...ratingFilter,
    },
    parsed.onSale === true,
    campaigns,
  );
  categoryBase = mergeHasOfferFilter(
    categoryBase,
    parsed.hasOffer === true,
    offerScopes,
  );

  const queryString: Record<string, string | undefined> = {
    page: String(parsed.page),
    limit: String(parsed.limit),
    sort: normalizeShopListSort(parsed.sort),
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
    .search(["name", "description", "shortDescription", "tags", "category", "subcategory", "fabric"])
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

  const enriched = enrichProductsWithSalePricing(products, campaigns);

  return {
    products: enriched,
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
  const { sortBy, sortOrder } = resolveShopSearchSort(parsed.sort);

  const searchResult = await advancedSearchService.searchProducts({
    query: parsed.search,
    sortBy,
    sortOrder,
    page: parsed.page,
    limit: parsed.limit,
    categories: parsed.categories,
    subcategories: parsed.subcategories,
    occasions: parsed.occasions,
    colors: parsed.colors,
    fabrics: parsed.fabrics,
    minPrice: parsed.minPrice,
    maxPrice: parsed.maxPrice,
    minRating: parsed.minRating,
    isFeatured: parsed.isFeatured,
    onSale: parsed.onSale,
    hasOffer: parsed.hasOffer,
    isActive: parsed.isActive,
    adminScope: parsed.adminScope,
    useCache: true,
  });

  const campaigns = await getActiveSaleCampaigns();
  return {
    products: enrichProductsWithSalePricing(
      searchResult.products as Record<string, unknown>[],
      campaigns,
    ),
    page: searchResult.page,
    limit: searchResult.limit,
    total: searchResult.total,
    hasNextPage: searchResult.page < searchResult.totalPages,
    searchMethod: searchResult.searchMethod,
    searchIntent: searchResult.searchIntent,
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
