import Blog from "../../models/Blog";
import { categoryRepository } from "../../repositories/categoryRepository";
import { subcategoryRepository } from "../../repositories/subcategoryRepository";
import { productRepository } from "../../repositories/productRepository";
import { loadCachedStorefrontSettings } from "../../controllers/storefrontController";
import { getCachedCategoryStats } from "../category/categoryListCacheService";
import { testimonialService } from "../testimonialService";
import { cachedFetch } from "../cache/cachedFetch";
import { getActiveSaleCampaigns } from "../sale/saleCacheService";
import { enrichProductsWithSalePricingAsync } from "../sale/saleProductEnrichment";
import {
  featuredCacheKey,
  getProductCacheVersion,
} from "../productCacheService";
import { listRandomProducts } from "../productListService";
import type { ParsedProductListQuery } from "../productQueryParser";
import { reconcileProductJson } from "../../types/utils/productStock";

const HOME_BUNDLE_CACHE_KEY = "cache:storefront:home-bundle:v1";
const HOME_BUNDLE_SOFT_TTL_SEC = 60;
const HOME_BUNDLE_HARD_TTL_SEC = 180;
const FEATURED_SOFT_TTL_SEC = 120;
const FEATURED_HARD_TTL_SEC = 360;

function leanProduct(p: Record<string, unknown>) {
  return reconcileProductJson(p as Parameters<typeof reconcileProductJson>[0]);
}

async function loadFeaturedProductsForHome(): Promise<Record<string, unknown>[]> {
  const campaigns = await getActiveSaleCampaigns();
  const v = await getProductCacheVersion();
  const cacheKey = `${featuredCacheKey(v)}:env`;
  const lean = await cachedFetch({
    key: cacheKey,
    softTtlSec: FEATURED_SOFT_TTL_SEC,
    hardTtlSec: FEATURED_HARD_TTL_SEC,
    fetchFresh: async () => {
      const products = await productRepository.findFeatured();
      return products.map(leanProduct) as Record<string, unknown>[];
    },
  });
  const enriched = await enrichProductsWithSalePricingAsync(lean, campaigns);
  return enriched.map(leanProduct);
}

const EXPLORE_RANDOM_QUERY: ParsedProductListQuery = {
  page: 1,
  limit: 12,
  sort: "",
  search: "",
  categories: [],
  subcategories: [],
  colors: [],
  fabrics: [],
  occasions: [],
  minRatings: [],
  isRandom: true,
  excludeIds: [],
  adminScope: false,
};

async function loadHomeExploreProducts(): Promise<Record<string, unknown>[]> {
  const result = await listRandomProducts(EXPLORE_RANDOM_QUERY);
  return result.products.map(leanProduct);
}

async function loadLatestHomeBlogs(limit = 3) {
  return Blog.find({ isPublished: true })
    .sort("-createdAt")
    .limit(limit)
    .select(
      "title slug images author isPublished viewCount excerpt tags category readingTimeMin createdAt",
    )
    .lean();
}

async function loadSareeSubcategories() {
  const cat = await categoryRepository.findBySlug("sarees");
  if (!cat) return [];
  return subcategoryRepository.listByCategorySlug("sarees");
}

function heroSlidesFromSettings(settings: Awaited<ReturnType<typeof loadCachedStorefrontSettings>>) {
  const incoming = settings?.heroSlides;
  if (!Array.isArray(incoming)) return [];
  return incoming.filter(
    (s) => s && s.isActive !== false && s.image && s.title,
  ) as Record<string, unknown>[];
}

async function assembleHomePageBundleFresh() {
  const [
    settings,
    categoryStats,
    sareeSubcategories,
    featuredProducts,
    latestBlogs,
    testimonials,
    exploreProducts,
  ] = await Promise.all([
    loadCachedStorefrontSettings(),
    getCachedCategoryStats(),
    loadSareeSubcategories(),
    loadFeaturedProductsForHome(),
    loadLatestHomeBlogs(3),
    testimonialService.listPublicForHome(),
    loadHomeExploreProducts(),
  ]);

  return {
    settings,
    heroSlides: heroSlidesFromSettings(settings),
    categoryStats,
    sareeSubcategories,
    featuredProducts,
    latestBlogs,
    testimonials,
    exploreProducts,
  };
}

/** One round-trip payload for the storefront home page SSR. */
export async function loadStorefrontHomePageBundle() {
  return cachedFetch({
    key: HOME_BUNDLE_CACHE_KEY,
    softTtlSec: HOME_BUNDLE_SOFT_TTL_SEC,
    hardTtlSec: HOME_BUNDLE_HARD_TTL_SEC,
    fetchFresh: assembleHomePageBundleFresh,
  });
}
