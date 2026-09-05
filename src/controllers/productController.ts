import { Request, Response, NextFunction } from "express";
import mongoose from "mongoose";
import Product from "../models/Product";
import Category from "../models/Category";
import SubCategory from "../models/SubCategory";
import AppError from "../types/utils/AppError";
import catchAsync from "../types/utils/catchAsync";
import APIFeatures from "../types/utils/apiFeatures";
import { IProduct } from "../types";
import {
  reconcileProductJson,
  sumVariantStocks,
} from "../types/utils/productStock";
import { mergeVariantsIntoProduct } from "../utils/variantMergeHelpers";
import { getCache, setCache, deleteCache } from "../services/cacheService";
import { productRepository } from "../repositories/productRepository";
import { sendPaginated, sendSuccess } from "../types/utils/response";
import { safeJsonParse } from "../types/utils/safeJson";
import { enqueueImageDelete } from "../queues/imageQueue";
import { cloudinaryInstance } from "../services/cloudinary";
import { CacheMutex } from "../types/utils/cacheMutex";
import { advancedSearchService } from "../services/advancedSearchService";
import {
  normalizeSearchQuery,
  parseProductListQuery,
  resolveShopSearchSort,
} from "../services/productQueryParser";
import { listProducts } from "../services/productListService";
import { getActiveSaleCampaigns } from "../services/sale/saleCacheService";
import { enrichProductsWithSalePricingAsync } from "../services/sale/saleProductEnrichment";
import { enrichProductWithPromotions } from "../services/promotion/promotionProductEnrichment";
import { notifyIndexNowStorefront } from "../services/indexNowService";
import {
  buildImagesFromMeta,
  countNewImageMetaSlots,
  distinctVariantColors,
  MAX_PRODUCT_IMAGES,
  parseImagesMeta,
  validateImagesMetaForVariants,
} from "../services/productImageService";
import {
  invalidateProductCaches,
  pdpCacheKey,
  featuredCacheKey,
  filtersCacheKey,
  getProductCacheVersion,
} from "../services/productCacheService";
import { getCachedProductCount } from "../services/productCountService";
import { LISTING_PROJECTION } from "../constants/productListing";
import { OFFLINE_MANUAL_PRODUCT_TAG } from "../constants/offlineOrder";
import {
  mergeFabricOptions,
  mergeOccasionOptions,
} from "../constants/productCatalog";
import {
  buildFilterColorOptions,
  canonicalizeVariantColors,
} from "../utils/catalogAttributes";
import { invalidateGiftingProductCache } from "../services/gifting/giftingProductDiscoveryService";
import { invalidatePremiumProductCache } from "../services/premium/premiumProductDiscoveryService";
const PDP_CACHE_TTL = 600;
const FILTERS_CACHE_TTL = 300;

/** Storefront serialize — never includes wholesale costPrice. */
function leanProduct(p: Record<string, unknown>) {
  return reconcileProductJson(p as Parameters<typeof reconcileProductJson>[0]);
}

/** Admin create/update responses — keep costPrice for inventory forms. */
function leanAdminProduct(p: Record<string, unknown>) {
  return reconcileProductJson(p as Parameters<typeof reconcileProductJson>[0], {
    includeCostPrice: true,
  });
}

function parseSizeGuideBody(raw: unknown): {
  enabled: boolean;
  title?: string;
  intro?: string;
  rows: { size: string; detail: string }[];
  tips: string[];
} {
  const parsed = safeJsonParse(
    raw,
    raw && typeof raw === "object" ? raw : {},
    "sizeGuide",
  ) as Record<string, unknown>;
  const rows = safeJsonParse(
    parsed.rows,
    Array.isArray(parsed.rows) ? parsed.rows : [],
    "sizeGuide.rows",
  ) as Array<{ size?: string; detail?: string }>;
  const tips = safeJsonParse(
    parsed.tips,
    Array.isArray(parsed.tips) ? parsed.tips : [],
    "sizeGuide.tips",
  ) as string[];

  return {
    enabled: parsed.enabled === true || parsed.enabled === "true",
    title: typeof parsed.title === "string" ? parsed.title.trim() : "",
    intro: typeof parsed.intro === "string" ? parsed.intro.trim() : "",
    rows: rows
      .map((row) => ({
        size: String(row.size ?? "").trim(),
        detail: String(row.detail ?? "").trim(),
      }))
      .filter((row) => row.size)
      .slice(0, 12),
    tips: tips
      .map((tip) => String(tip ?? "").trim())
      .filter(Boolean)
      .slice(0, 6),
  };
}

function minRatingMongoFilter(
  query: Request["query"],
): Record<string, unknown> {
  const raw = query.minRating;
  const s =
    typeof raw === "string" ? raw.trim()
    : Array.isArray(raw) && typeof raw[0] === "string" ? raw[0].trim()
    : "";
  if (!s) return {};
  const n = Number.parseInt(s, 10);
  if (!Number.isFinite(n) || n < 1 || n > 5) return {};
  return { "ratings.average": { $gte: n } };
}

// ─── getAllProducts ────────────────────────────────────────────────────────────

export const getAllProducts = catchAsync(
  async (req: Request, res: Response) => {
    const parsed = parseProductListQuery(req);
    parsed.adminScope = false;

    const result = await listProducts(
      parsed,
      req.query as Record<string, string | undefined>,
    );

    sendPaginated(
      res,
      {
        products: result.products.map(leanProduct),
        ...(result.searchMethod ? { searchMethod: result.searchMethod } : {}),
        ...(result.searchIntent ? { searchIntent: result.searchIntent } : {}),
      },
      {
        page: result.page,
        limit: result.limit,
        total: result.total,
        hasNextPage: result.hasNextPage,
      },
    );
  },
);

// ─── searchProducts ────────────────────────────────────────────────────────────

export const searchProducts = catchAsync(
  async (req: Request, res: Response) => {
    const q = normalizeSearchQuery(req.query.q);
    const parsedSearch = parseProductListQuery(req);
    const categories = parsedSearch.categories;
    const colors = parsedSearch.colors;
    const page = parsedSearch.page;
    const limit = parsedSearch.limit;
    const { sortBy, sortOrder } = resolveShopSearchSort(
      typeof req.query.sort === "string" ? req.query.sort : "-createdAt",
      typeof req.query.sortBy === "string" ? req.query.sortBy : undefined,
      typeof req.query.sortOrder === "string" ? req.query.sortOrder : undefined,
    );

    const searchResult = await advancedSearchService.searchProducts({
      query: q,
      sortBy,
      sortOrder,
      page,
      limit,
      categories,
      subcategories: parsedSearch.subcategories,
      occasions: parsedSearch.occasions,
      colors: parsedSearch.colors,
      fabrics: parsedSearch.fabrics,
      minPrice: parsedSearch.minPrice,
      maxPrice: parsedSearch.maxPrice,
      minRating: parsedSearch.minRating,
      isFeatured: parsedSearch.isFeatured,
      onSale: parsedSearch.onSale,
      adminScope: false,
      useCache: true,
    });

    sendPaginated(
      res,
      {
        products: searchResult.products.map(leanProduct),
        searchMethod: searchResult.searchMethod,
        cached: searchResult.cached,
        searchIntent: searchResult.searchIntent,
      },
      {
        page: searchResult.page,
        limit: searchResult.limit,
        total: searchResult.total,
        hasNextPage: searchResult.page < searchResult.totalPages,
      },
    );
  },
);

export const autocompleteSearch = catchAsync(
  async (req: Request, res: Response) => {
    const q = normalizeSearchQuery(req.query.q);
    const limit = Math.min(Math.max(1, Number(req.query.limit) || 5), 10);

    if (!q) {
      return sendSuccess(res, { suggestions: [], query: "" });
    }

    const suggestions = await advancedSearchService.autocomplete(q, limit);
    sendSuccess(res, {
      suggestions: suggestions.suggestions,
      query: q,
      searchIntent: suggestions.intent,
      querySuggestions: suggestions.querySuggestions,
      didYouMean: suggestions.intent.didYouMean,
    });
  },
);

export const getSearchSuggestions = catchAsync(
  async (req: Request, res: Response) => {
    const q = normalizeSearchQuery(req.query.q);
    if (!q) {
      return sendSuccess(res, { suggestions: [], query: "" });
    }
    const suggestions = await advancedSearchService.getSearchSuggestions(q);
    sendSuccess(res, { suggestions, query: q });
  },
);

export const getTrendingSearches = catchAsync(
  async (req: Request, res: Response) => {
    const limit = Math.min(Math.max(1, Number(req.query.limit) || 20), 20);
    const trending = await advancedSearchService.getTrendingSearches(limit);
    sendSuccess(res, { trending });
  },
);

export const recordProductView = catchAsync(
  async (req: Request, res: Response, next: NextFunction) => {
    const updated = await Product.findOneAndUpdate(
      {
        slug: req.params.slug,
        isActive: true,
        tags: { $nin: [OFFLINE_MANUAL_PRODUCT_TAG] },
      },
      { $inc: { viewCount: 1 } },
      { new: true, select: "viewCount slug" },
    );
    if (!updated) {
      return next(new AppError("No product found with that slug.", 404));
    }

    const v = await getProductCacheVersion();
    deleteCache(pdpCacheKey(v, updated.slug)).catch(() => {});

    sendSuccess(res, { viewCount: updated.viewCount });
  },
);

export const getProduct = catchAsync(
  async (req: Request, res: Response, next: NextFunction) => {
    const { slug } = req.params;
    const v = await getProductCacheVersion();
    const cacheKey = pdpCacheKey(v, slug);

    const cached = await getCache<Record<string, unknown>>(cacheKey);
    if (cached) {
      const campaigns = await getActiveSaleCampaigns();
      const [enriched] = await enrichProductsWithSalePricingAsync(
        [leanProduct(cached) as Record<string, unknown>],
        campaigns,
      );
      const withPromos = await enrichProductWithPromotions(enriched);
      return sendSuccess(res, { product: withPromos });
    }

    const mutex = new CacheMutex(cacheKey, { ttlMs: 5000 });
    const product = await mutex.withLock(async () => {
      const recheck = await getCache<Record<string, unknown>>(cacheKey);
      if (recheck) return recheck;

      const byId =
        mongoose.Types.ObjectId.isValid(slug) && String(slug).length === 24;
      const dbProduct = await Product.findOne(
        byId
          ? {
              _id: slug,
              isActive: true,
              tags: { $nin: [OFFLINE_MANUAL_PRODUCT_TAG] },
            }
          : {
              slug,
              isActive: true,
              tags: { $nin: [OFFLINE_MANUAL_PRODUCT_TAG] },
            },
      ).lean<Record<string, unknown>>();

      if (!dbProduct) return null;

      const [enriched] = await enrichProductsWithSalePricingAsync(
        [leanProduct(dbProduct) as Record<string, unknown>],
        await getActiveSaleCampaigns(),
      );
      const transformed = await enrichProductWithPromotions(enriched);
      setCache(cacheKey, transformed, PDP_CACHE_TTL).catch(() => {});
      return transformed;
    });

    if (product === null) {
      const dbProduct = await Product.findOne({
        slug,
        isActive: true,
        tags: { $nin: [OFFLINE_MANUAL_PRODUCT_TAG] },
      }).lean<Record<string, unknown>>();

      if (!dbProduct) {
        return next(new AppError("No product found with that slug.", 404));
      }
      const [enriched] = await enrichProductsWithSalePricingAsync(
        [leanProduct(dbProduct) as Record<string, unknown>],
        await getActiveSaleCampaigns(),
      );
      const withPromos = await enrichProductWithPromotions(enriched);
      return sendSuccess(res, { product: withPromos });
    }

    const [freshEnriched] = await enrichProductsWithSalePricingAsync(
      [leanProduct(product) as Record<string, unknown>],
      await getActiveSaleCampaigns(),
    );
    const withPromos = await enrichProductWithPromotions(freshEnriched);
    sendSuccess(res, { product: withPromos });
  },
);

export const getFeaturedProducts = catchAsync(
  async (_req: Request, res: Response) => {
    const campaigns = await getActiveSaleCampaigns();
    const v = await getProductCacheVersion();
    const cacheKey = featuredCacheKey(v);
    const cached = await getCache<Record<string, unknown>[]>(cacheKey);
    if (cached) {
      const enriched = await enrichProductsWithSalePricingAsync(
        cached.map(leanProduct) as Record<string, unknown>[],
        campaigns,
      );
      return sendSuccess(res, { products: enriched.map(leanProduct) });
    }
    const products = await productRepository.findFeatured();
    const lean = products.map(leanProduct);
    setCache(cacheKey, lean, 120).catch(() => {});
    const enriched = await enrichProductsWithSalePricingAsync(
      lean as Record<string, unknown>[],
      campaigns,
    );
    sendSuccess(res, { products: enriched.map(leanProduct) });
  },
);

export const getProductsByCategory = catchAsync(
  async (req: Request, res: Response) => {
    const categoryBaseFilter: Record<string, unknown> = {
      category: req.params.category,
      isActive: true,
      tags: { $nin: [OFFLINE_MANUAL_PRODUCT_TAG] },
    };
    const ratingFilter = minRatingMongoFilter(req.query);

    const features = new APIFeatures<IProduct>(
      Product.find({ ...categoryBaseFilter, ...ratingFilter }),
      req.query as Record<string, string>,
    )
      .filter()
      .sort()
      .paginate();

    const mongoFilter = {
      ...categoryBaseFilter,
      ...ratingFilter,
      ...features.getMongoFilter(),
    };

    const [products, totalCount] = await Promise.all([
      features.query
        .select(LISTING_PROJECTION)
        .lean<Record<string, unknown>[]>()
        .maxTimeMS(5000),
      getCachedProductCount(mongoFilter),
    ]);

    const campaigns = await getActiveSaleCampaigns();
    const enriched = await enrichProductsWithSalePricingAsync(
      products.map(leanProduct) as Record<string, unknown>[],
      campaigns,
    );

    sendPaginated(
      res,
      { products: enriched.map(leanProduct) },
      {
        page: features.getPage(),
        limit: features.getLimit(),
        total: totalCount,
      },
    );
  },
);

export const getFilterOptions = catchAsync(
  async (req: Request, res: Response) => {
    const categoryParam =
      typeof req.query.category === "string" ? req.query.category.trim() : "";
    const categoryIdParam =
      typeof req.query.categoryId === "string" ? req.query.categoryId.trim() : "";
    const subcategoryIdParam =
      typeof req.query.subcategoryId === "string" ? req.query.subcategoryId.trim() : "";

    const v = await getProductCacheVersion();
    const cacheKey = filtersCacheKey(v, `cc1-${categoryParam || 'all'}-${categoryIdParam || 'all'}-${subcategoryIdParam || 'all'}`);
    const cached = await getCache<{
      categories: string[];
      colors: string[];
      colorCodes: Record<string, string>;
      fabrics: string[];
      subcategories: string[];
      occasions: string[];
      tags: string[];
      categoryTree: Array<{
        name: string;
        slug: string;
        subcategories: Array<{ name: string; slug: string }>;
      }>;
      priceRange: { minPrice: number; maxPrice: number };
    }>(cacheKey);
    if (cached) return sendSuccess(res, cached);

    const shopMatch: Record<string, unknown> = {
      isActive: true,
      isPremium: { $ne: true },
      category: { $nin: ["Gifting", "Premium"] },
      tags: { $nin: [OFFLINE_MANUAL_PRODUCT_TAG] },
    };

    const scopedMatch: Record<string, unknown> = { ...shopMatch };
    if (categoryParam) scopedMatch.category = categoryParam;
    if (categoryIdParam) scopedMatch.categoryId = new mongoose.Types.ObjectId(categoryIdParam);
    if (subcategoryIdParam) scopedMatch.subcategoryId = new mongoose.Types.ObjectId(subcategoryIdParam);

    const [facet] = await Product.aggregate<{
      allCategories: { categories: string[] }[];
      allColors: { color: string; colorCode: string }[];
      allFabrics: { fabrics: string[] }[];
      allSubcategories: { subcategories: string[] }[];
      allTags: { tags: string[] }[];
      allOccasions: { occasions: string[] }[];
      scopedPrice: {
        minPrice: number;
        maxPrice: number;
      }[];
    }>([
      {
        $facet: {
          allCategories: [
            { $match: shopMatch },
            {
              $group: {
                _id: null,
                categories: { $addToSet: "$category" },
              },
            },
          ],
          allColors: [
            { $match: shopMatch },
            { $unwind: "$variants" },
            { $match: { "variants.color": { $exists: true, $ne: "" } } },
            {
              $group: {
                _id: {
                  color: "$variants.color",
                  colorCode: { $ifNull: ["$variants.colorCode", ""] },
                },
              },
            },
            {
              $project: {
                _id: 0,
                color: "$_id.color",
                colorCode: "$_id.colorCode",
              },
            },
          ],
          allFabrics: [
            { $match: { ...shopMatch, fabric: { $exists: true, $ne: "" } } },
            {
              $group: {
                _id: null,
                fabrics: { $addToSet: "$fabric" },
              },
            },
          ],
          allSubcategories: [
            { $match: { ...shopMatch, subcategory: { $exists: true, $ne: "" } } },
            {
              $group: {
                _id: null,
                subcategories: { $addToSet: "$subcategory" },
              },
            },
          ],
          allTags: [
            { $match: shopMatch },
            { $unwind: "$tags" },
            {
              $group: {
                _id: null,
                tags: { $addToSet: "$tags" },
              },
            },
          ],
          allOccasions: [
            { $match: shopMatch },
            { $unwind: "$occasions" },
            {
              $group: {
                _id: null,
                occasions: { $addToSet: "$occasions" },
              },
            },
          ],
          scopedPrice: [
            { $match: scopedMatch },
            {
              $group: {
                _id: null,
                minPrice: { $min: "$price" },
                maxPrice: { $max: "$price" },
              },
            },
          ],
        },
      },
    ]).option({ maxTimeMS: 4000 });

    const allCategories = facet?.allCategories?.[0];
    const { colors: filterColors, colorCodes: filterColorCodes } =
      buildFilterColorOptions(facet?.allColors ?? []);
    const allFabrics = facet?.allFabrics?.[0];
    const allSubcategories = facet?.allSubcategories?.[0];
    const allTags = facet?.allTags?.[0];
    const allOccasions = facet?.allOccasions?.[0];
    const scopedPrice = facet?.scopedPrice?.[0];

    const productCategoryNames = new Set(
      (allCategories?.categories ?? []).filter(Boolean) as string[],
    );
    const productSubcategoryNames = new Set(
      (allSubcategories?.subcategories ?? []).filter(Boolean) as string[],
    );

    const [dbCategories, dbSubcategories] = await Promise.all([
      Category.find({ isActive: true, isGiftCategory: { $ne: true } })
        .sort({ sortOrder: 1, name: 1 })
        .select("name slug sortOrder")
        .lean(),
      SubCategory.find({ isActive: true })
        .sort({ sortOrder: 1, name: 1 })
        .select("name slug categorySlug categoryId sortOrder productCount")
        .lean(),
    ]);

    const categoryTree = dbCategories
      .filter((cat) => cat.name !== "Gifting" && productCategoryNames.has(cat.name))
      .map((cat) => {
        const catId = String(cat._id);
        const subs = dbSubcategories
          .filter(
            (sub) =>
              sub.categorySlug === cat.slug ||
              String(sub.categoryId) === catId,
          )
          .filter(
            (sub) =>
              (sub.productCount ?? 0) > 0 || productSubcategoryNames.has(sub.name),
          )
          .map((sub) => ({ name: sub.name, slug: sub.slug }));
        return {
          name: cat.name,
          slug: cat.slug,
          subcategories: subs,
        };
      })
      .filter(
        (cat) =>
          cat.subcategories.length > 0 || productCategoryNames.has(cat.name),
      );

    const result = {
      categories: (allCategories?.categories ?? [])
        .filter(Boolean)
        .filter((c) => c !== "Gifting")
        .sort() as string[],
      colors: filterColors,
      colorCodes: filterColorCodes,
      fabrics: mergeFabricOptions(
        (allFabrics?.fabrics ?? []).filter(Boolean) as string[],
      ),
      subcategories: (allSubcategories?.subcategories ?? [])
        .filter(Boolean)
        .sort() as string[],
      occasions: mergeOccasionOptions(
        (allOccasions?.occasions ?? []).filter(Boolean) as string[],
      ),
      tags: (allTags?.tags ?? []).filter(Boolean).sort() as string[],
      categoryTree,
      priceRange: {
        minPrice: scopedPrice?.minPrice ?? 0,
        maxPrice: scopedPrice?.maxPrice ?? 100000,
      },
    };

    setCache(cacheKey, result, FILTERS_CACHE_TTL).catch(() => {});
    sendSuccess(res, result);
  },
);

export const createProduct = catchAsync(
  async (req: Request, res: Response, next: NextFunction) => {
    const uploadedImages = (
      req as Request & { uploadedImages?: { url: string; publicId: string }[] }
    ).uploadedImages;
    const uploadedPremiumHero = (
      req as Request & {
        uploadedPremiumHero?: { url: string; publicId: string };
      }
    ).uploadedPremiumHero;

    const imagesMeta = parseImagesMeta(req.body.imagesMeta);
    const hasMeta = imagesMeta.length > 0;

    const variantsParsed = canonicalizeVariantColors(
      safeJsonParse(
        req.body.variants,
        req.body.variants,
        "variants",
      ) as Array<{
        sku?: string;
        size?: string;
        color?: string;
        colorCode?: string;
        stock?: number;
        costPrice?: number;
        price?: number;
      }>,
    );
    const isMultiColor = distinctVariantColors(variantsParsed).length >= 2;

    if (!hasMeta && uploadedImages?.length && isMultiColor) {
      return next(
        new AppError(
          "Multi-color products need per-shade image tags. Refresh the admin form and save again.",
          400,
        ),
      );
    }

    if (!hasMeta && !uploadedImages?.length) {
      return next(
        new AppError("Please upload at least one product image.", 400),
      );
    }
    if (uploadedImages && uploadedImages.length > MAX_PRODUCT_IMAGES) {
      return next(
        new AppError(
          `A product can have at most ${MAX_PRODUCT_IMAGES} images.`,
          400,
        ),
      );
    }
    if (hasMeta && imagesMeta.length > MAX_PRODUCT_IMAGES) {
      return next(
        new AppError(
          `A product can have at most ${MAX_PRODUCT_IMAGES} images.`,
          400,
        ),
      );
    }

    const expectedNewUploads = hasMeta ? countNewImageMetaSlots(imagesMeta) : 0;
    const receivedUploads = uploadedImages?.length ?? 0;
    if (hasMeta && expectedNewUploads !== receivedUploads) {
      return next(
        new AppError(
          `Image upload mismatch: form expects ${expectedNewUploads} new file(s) but received ${receivedUploads}. Refresh the page and try again.`,
          400,
        ),
      );
    }

    if (hasMeta) {
      const metaErr = validateImagesMetaForVariants(imagesMeta, variantsParsed);
      if (metaErr) return next(new AppError(metaErr, 400));
    }

    const images =
      hasMeta ?
        buildImagesFromMeta(
          imagesMeta,
          uploadedImages || [],
          req.body.name,
        )
      : (uploadedImages || []).map((img, index) => ({
          url: img.url,
          publicId: img.publicId,
          alt: `${req.body.name} - Image ${index + 1}`,
        }));

    if (!images.length) {
      return next(
        new AppError("Please upload at least one product image.", 400),
      );
    }
    if (hasMeta && images.length !== imagesMeta.length) {
      return next(
        new AppError(
          `Image sync failed: expected ${imagesMeta.length} image(s) but assembled ${images.length}. Refresh the edit form and save again.`,
          400,
        ),
      );
    }

    const productData = {
      ...req.body,
      images,
      variants: variantsParsed,
      tags: safeJsonParse(req.body.tags, req.body.tags || [], "tags"),
      price: Number(req.body.price),
      comparePrice:
        req.body.comparePrice ? Number(req.body.comparePrice) : undefined,
      isFeatured:
        req.body.isFeatured === "true" || req.body.isFeatured === true,
      isActive: req.body.isActive !== "false" && req.body.isActive !== false,
      isGiftable:
        req.body.isGiftable === "true" || req.body.isGiftable === true,
      isCustomizable:
        req.body.isCustomizable === "true" || req.body.isCustomizable === true,
      minOrderQty: req.body.minOrderQty ? Number(req.body.minOrderQty) : 1,
      occasions: safeJsonParse(
        req.body.occasions,
        req.body.occasions || [],
        "occasions",
      ),
      customFields: safeJsonParse(
        req.body.customFields,
        req.body.customFields || [],
        "customFields",
      ),
      productDetails: safeJsonParse(
        req.body.productDetails,
        req.body.productDetails || [],
        "productDetails",
      ),
      highlights: safeJsonParse(
        req.body.highlights,
        req.body.highlights || [],
        "highlights",
      ),
      sizeGuide: parseSizeGuideBody(req.body.sizeGuide),
      careInstructions: String(req.body.careInstructions ?? "").trim(),
      motionReelUrl: String(req.body.motionReelUrl ?? "").trim(),
      isPremium:
        req.body.isPremium === "true" || req.body.isPremium === true,
      premiumSlug:
        typeof req.body.premiumSlug === "string" ?
          req.body.premiumSlug.trim().toLowerCase() || undefined
        : undefined,
      premiumSubtitle:
        typeof req.body.premiumSubtitle === "string" ?
          req.body.premiumSubtitle.trim() || undefined
        : undefined,
      craftNote:
        typeof req.body.craftNote === "string" ?
          req.body.craftNote.trim() || undefined
        : undefined,
      weaveHours:
        req.body.weaveHours !== undefined && req.body.weaveHours !== "" ?
          Number(req.body.weaveHours)
        : undefined,
      sortOrderPremium:
        req.body.sortOrderPremium !== undefined && req.body.sortOrderPremium !== "" ?
          Number(req.body.sortOrderPremium)
        : 0,
      premiumEditorialOpen: safeJsonParse(
        req.body.premiumEditorialOpen,
        req.body.premiumEditorialOpen,
        "premiumEditorialOpen",
      ),
      premiumEditorialClose: safeJsonParse(
        req.body.premiumEditorialClose,
        req.body.premiumEditorialClose,
        "premiumEditorialClose",
      ),
    };
    if (productData.isPremium) {
      productData.category = "Premium";
      productData.subcategory = "";
      delete (productData as Record<string, unknown>).subcategoryId;
    }
    const uploadedMotionVideo = (
      req as Request & {
        uploadedMotionVideo?: { url: string; publicId: string };
      }
    ).uploadedMotionVideo;
    if (uploadedMotionVideo) {
      productData.motionVideoUrl = uploadedMotionVideo.url;
      productData.motionVideoPublicId = uploadedMotionVideo.publicId;
    } else if (req.body.motionVideoUrl) {
      productData.motionVideoUrl = String(req.body.motionVideoUrl).trim();
      if (req.body.motionVideoPublicId) {
        productData.motionVideoPublicId = String(
          req.body.motionVideoPublicId,
        ).trim();
      }
    }
    if (uploadedPremiumHero) {
      (productData as Record<string, unknown>).premiumHeroImage = {
        url: uploadedPremiumHero.url,
        publicId: uploadedPremiumHero.publicId,
        alt: `${req.body.name} - Premium hero`,
      };
    } else if (req.body.premiumHeroUrl && req.body.premiumHeroPublicId) {
      (productData as Record<string, unknown>).premiumHeroImage = {
        url: String(req.body.premiumHeroUrl).trim(),
        publicId: String(req.body.premiumHeroPublicId).trim(),
        alt: `${req.body.name} - Premium hero`,
      };
    }
    delete (productData as Record<string, unknown>).totalStock;
    (productData as Record<string, unknown>).totalStock =
      sumVariantStocks(variantsParsed);

    if (productData.category === "Gifting") {
      productData.isGiftable = true;
    }

    const product = await Product.create(productData);
    await invalidateProductCaches();
    if (productData.isGiftable || productData.category === "Gifting") {
      invalidateGiftingProductCache();
    }
    if (productData.isPremium) {
      invalidatePremiumProductCache();
    }

    const lean = await Product.findById(product._id).lean<
      Record<string, unknown>
    >();
    if (!lean) {
      return next(
        new AppError("Product created but could not be retrieved.", 500),
      );
    }
    if (lean.isActive !== false) {
      const slug = String(lean.slug || "");
      if (slug) notifyIndexNowStorefront(`/shop/${encodeURIComponent(slug)}`);
    }
    if (lean.isActive !== false) {
      const { notifyWhatsAppCatalogAlert } = await import(
        "../services/whatsappNotifyService"
      );
      notifyWhatsAppCatalogAlert({
        kind: "product",
        title: String(lean.name || "New arrival"),
        path: `/shop/${encodeURIComponent(String(lean.slug || ""))}`,
      });
    }
    sendSuccess(res, { product: leanAdminProduct(lean) }, "Product created", 201);
  },
);

export const updateProduct = catchAsync(
  async (req: Request, res: Response, next: NextFunction) => {
    const productId = req.params.id;
    const updateData: Record<string, unknown> = { ...req.body };

    const currentProduct = await Product.findById(productId);
    if (!currentProduct) {
      return next(new AppError("No product found with that ID.", 404));
    }

    const uploadedImages = (
      req as Request & { uploadedImages?: { url: string; publicId: string }[] }
    ).uploadedImages;
    const uploadedPremiumHero = (
      req as Request & {
        uploadedPremiumHero?: { url: string; publicId: string };
      }
    ).uploadedPremiumHero;
    const imagesMeta = parseImagesMeta(req.body.imagesMeta);
    const hasMeta = imagesMeta.length > 0;

    const variantsForColorCheck =
      req.body.variants && typeof req.body.variants === "string" ?
        safeJsonParse(req.body.variants, req.body.variants, "variants")
      : currentProduct.variants;
    const isMultiColor =
      distinctVariantColors(variantsForColorCheck).length >= 2;

    if (!hasMeta && uploadedImages?.length && isMultiColor) {
      return next(
        new AppError(
          "Multi-color products need per-shade image tags. Refresh the admin form and save again.",
          400,
        ),
      );
    }

    if (hasMeta) {
      if (imagesMeta.length > MAX_PRODUCT_IMAGES) {
        return next(
          new AppError(
            `A product can have at most ${MAX_PRODUCT_IMAGES} images.`,
            400,
          ),
        );
      }
      const expectedNewUploads = countNewImageMetaSlots(imagesMeta);
      const receivedUploads = uploadedImages?.length ?? 0;
      if (expectedNewUploads !== receivedUploads) {
        return next(
          new AppError(
            `Image upload mismatch: form expects ${expectedNewUploads} new file(s) but received ${receivedUploads}. Refresh the page and try again.`,
            400,
          ),
        );
      }

      const variantsForMeta =
        req.body.variants && typeof req.body.variants === "string" ?
          safeJsonParse(req.body.variants, req.body.variants, "variants")
        : (updateData.variants as { color?: string }[] | undefined) ||
          currentProduct.variants;

      const metaErr = validateImagesMetaForVariants(
        imagesMeta,
        variantsForMeta,
      );
      if (metaErr) return next(new AppError(metaErr, 400));

      const built = buildImagesFromMeta(
        imagesMeta,
        uploadedImages || [],
        req.body.name || currentProduct.name,
        currentProduct.images,
      );
      if (!built.length) {
        return next(
          new AppError("Product must have at least one image.", 400),
        );
      }
      if (built.length !== imagesMeta.length) {
        return next(
          new AppError(
            `Image sync failed: expected ${imagesMeta.length} image(s) but assembled ${built.length}. Refresh the edit form and save again.`,
            400,
          ),
        );
      }
      updateData.images = built;
    } else if (uploadedImages?.length) {
      const combined = currentProduct.images.length + uploadedImages.length;
      if (combined > MAX_PRODUCT_IMAGES) {
        return next(
          new AppError(
            `Cannot add ${uploadedImages.length} image(s): product already has ${currentProduct.images.length} (max ${MAX_PRODUCT_IMAGES} total).`,
            400,
          ),
        );
      }
      const newImages = uploadedImages.map((img, index) => ({
        url: img.url,
        publicId: img.publicId,
        alt: `${req.body.name || currentProduct.name} - Image ${index + 1}`,
      }));
      updateData.images = [...currentProduct.images, ...newImages];
    }

    if (req.body.isFeatured !== undefined) {
      updateData.isFeatured =
        req.body.isFeatured === "true" || req.body.isFeatured === true;
    }
    if (req.body.isActive !== undefined) {
      updateData.isActive =
        req.body.isActive !== "false" && req.body.isActive !== false;
    }
    if (req.body.variants && typeof req.body.variants === "string") {
      const parsedVariants = canonicalizeVariantColors(
        safeJsonParse(
          req.body.variants,
          req.body.variants,
          "variants",
        ) as Array<{
          sku?: string;
          size?: string;
          color?: string;
          colorCode?: string;
          stock?: number;
          costPrice?: number;
          price?: number;
        }>,
      );
      updateData.variants = mergeVariantsIntoProduct(
        parsedVariants,
        currentProduct,
      );
    }
    if (req.body.customFields !== undefined) {
      updateData.customFields = safeJsonParse(
        req.body.customFields,
        req.body.customFields,
        "customFields",
      );
    }
    if (req.body.productDetails !== undefined) {
      updateData.productDetails = safeJsonParse(
        req.body.productDetails,
        req.body.productDetails,
        "productDetails",
      );
    }
    if (req.body.highlights !== undefined) {
      updateData.highlights = safeJsonParse(
        req.body.highlights,
        req.body.highlights,
        "highlights",
      );
    }
    if (req.body.sizeGuide !== undefined) {
      updateData.sizeGuide = parseSizeGuideBody(req.body.sizeGuide);
    }
    if (req.body.isGiftable !== undefined) {
      updateData.isGiftable =
        req.body.isGiftable === "true" || req.body.isGiftable === true;
    }
    if (req.body.isCustomizable !== undefined) {
      updateData.isCustomizable =
        req.body.isCustomizable === "true" || req.body.isCustomizable === true;
    }
    if (req.body.minOrderQty !== undefined) {
      updateData.minOrderQty = Number(req.body.minOrderQty);
    }
    if (req.body.hsnCode !== undefined) {
      updateData.hsnCode =
        typeof req.body.hsnCode === "string" ?
          req.body.hsnCode.trim()
        : req.body.hsnCode;
    }
    if (req.body.price !== undefined) {
      updateData.price = Number(req.body.price);
    }
    if (req.body.comparePrice !== undefined) {
      const cp = String(req.body.comparePrice ?? "").trim();
      updateData.comparePrice = cp ? Number(cp) : undefined;
    }

    if (req.body.isPremium !== undefined) {
      updateData.isPremium =
        req.body.isPremium === "true" || req.body.isPremium === true;
    }
    const nextIsPremium =
      updateData.isPremium !== undefined ?
        Boolean(updateData.isPremium)
      : Boolean(currentProduct.isPremium);
    if (nextIsPremium) {
      updateData.category = "Premium";
      updateData.subcategory = "";
      updateData.subcategoryId = null;
    }
    for (const key of [
      "premiumSlug",
      "premiumSubtitle",
      "craftNote",
    ] as const) {
      if (req.body[key] !== undefined) {
        const val = String(req.body[key] ?? "").trim();
        updateData[key] = key === "premiumSlug" ? val.toLowerCase() || undefined : val || undefined;
      }
    }
    if (req.body.weaveHours !== undefined && req.body.weaveHours !== "") {
      updateData.weaveHours = Number(req.body.weaveHours);
    }
    if (req.body.sortOrderPremium !== undefined && req.body.sortOrderPremium !== "") {
      updateData.sortOrderPremium = Number(req.body.sortOrderPremium);
    }
    if (req.body.premiumEditorialOpen !== undefined) {
      updateData.premiumEditorialOpen = safeJsonParse(
        req.body.premiumEditorialOpen,
        req.body.premiumEditorialOpen,
        "premiumEditorialOpen",
      );
    }
    if (req.body.premiumEditorialClose !== undefined) {
      updateData.premiumEditorialClose = safeJsonParse(
        req.body.premiumEditorialClose,
        req.body.premiumEditorialClose,
        "premiumEditorialClose",
      );
    }
    if (uploadedPremiumHero) {
      updateData.premiumHeroImage = {
        url: uploadedPremiumHero.url,
        publicId: uploadedPremiumHero.publicId,
        alt: `${req.body.name || currentProduct.name} - Premium hero`,
      };
    } else if (req.body.premiumHeroUrl && req.body.premiumHeroPublicId) {
      updateData.premiumHeroImage = {
        url: String(req.body.premiumHeroUrl).trim(),
        publicId: String(req.body.premiumHeroPublicId).trim(),
        alt: `${req.body.name || currentProduct.name} - Premium hero`,
      };
    }

    for (const key of [
      "shortDescription",
      "subcategory",
      "fabric",
      "careInstructions",
      "motionReelUrl",
      "seoTitle",
      "seoDescription",
    ] as const) {
      if (req.body[key] !== undefined) {
        const val = String(req.body[key] ?? "").trim();
        updateData[key] = val || "";
      }
    }

    const uploadedMotionVideo = (
      req as Request & {
        uploadedMotionVideo?: { url: string; publicId: string };
      }
    ).uploadedMotionVideo;
    if (uploadedMotionVideo) {
      updateData.motionVideoUrl = uploadedMotionVideo.url;
      updateData.motionVideoPublicId = uploadedMotionVideo.publicId;
    } else if (
      req.body.clearMotionVideo === "true" ||
      req.body.clearMotionVideo === true
    ) {
      const oldVideoId = currentProduct.motionVideoPublicId?.trim();
      if (oldVideoId) {
        cloudinaryInstance.uploader
          .destroy(oldVideoId, { resource_type: "video" })
          .catch(() => {});
      }
      updateData.motionVideoUrl = "";
      updateData.motionVideoPublicId = "";
    } else if (req.body.motionVideoUrl !== undefined) {
      const url = String(req.body.motionVideoUrl ?? "").trim();
      updateData.motionVideoUrl = url;
      if (req.body.motionVideoPublicId !== undefined) {
        updateData.motionVideoPublicId = String(
          req.body.motionVideoPublicId ?? "",
        ).trim();
      }
      if (!url) updateData.motionVideoPublicId = "";
    }

    if (req.body.tags !== undefined) {
      if (typeof req.body.tags === "string") {
        const raw = req.body.tags.trim();
        updateData.tags =
          raw ? safeJsonParse(req.body.tags, req.body.tags, "tags") : [];
      }
    }
    if (req.body.occasions !== undefined) {
      if (typeof req.body.occasions === "string") {
        const raw = req.body.occasions.trim();
        updateData.occasions =
          raw ?
            safeJsonParse(req.body.occasions, req.body.occasions, "occasions")
          : [];
      }
    }

    delete updateData.updatedAt;
    delete updateData.totalStock;
    delete updateData.imagesMeta;
    delete updateData.premiumHeroUrl;
    delete updateData.premiumHeroPublicId;
    delete updateData.premiumHeroImage;
    delete updateData.clearMotionVideo;
    if (
      updateData.category === "Gifting" ||
      currentProduct.category === "Gifting"
    ) {
      updateData.isGiftable = true;
    }
    if (updateData.variants) {
      updateData.totalStock = sumVariantStocks(
        updateData.variants as { stock?: number }[],
      );
    }

    const clientUpdatedAt = req.body.updatedAt || req.body.__v;
    const filter: Record<string, unknown> = { _id: productId };
    if (clientUpdatedAt) {
      filter.updatedAt = new Date(clientUpdatedAt);
    }

    const updatedProduct = await Product.findOneAndUpdate(filter, updateData, {
      new: true,
      runValidators: true,
    }).lean<Record<string, unknown>>();

    if (!updatedProduct) {
      return next(
        new AppError(
          "Product was updated by someone else. Refresh the page and try again.",
          409,
        ),
      );
    }

    const slug = String(updatedProduct.slug || currentProduct.slug);
    await invalidateProductCaches({ slug });
    const giftable =
      updateData.isGiftable === true ||
      updateData.category === "Gifting" ||
      currentProduct.isGiftable ||
      currentProduct.category === "Gifting";
    if (giftable) invalidateGiftingProductCache();
    const premium =
      updateData.isPremium === true ||
      currentProduct.isPremium;
    if (premium) invalidatePremiumProductCache();

    if (updatedProduct.isActive !== false) {
      notifyIndexNowStorefront(`/shop/${encodeURIComponent(slug)}`);
    }

    sendSuccess(
      res,
      { product: leanAdminProduct(updatedProduct) },
      "Product updated",
    );
  },
);

export const deleteProduct = catchAsync(
  async (req: Request, res: Response, next: NextFunction) => {
    const product = await Product.findById(req.params.id);
    if (!product)
      return next(new AppError("No product found with that ID.", 404));

    const publicIds = product.images.map((img) => img.publicId);
    const slug = product.slug;

    await Product.findByIdAndDelete(req.params.id);
    enqueueImageDelete(publicIds).catch(() => {});
    await invalidateProductCaches({ slug });

    res.status(204).end();
  },
);

export const deleteProductImage = catchAsync(
  async (req: Request, res: Response, next: NextFunction) => {
    const { id } = req.params;
    const rawParam = req.params.publicId;
    const decodedId = decodeURIComponent(rawParam);

    const product = await Product.findById(id);
    if (!product)
      return next(new AppError("No product found with that ID.", 404));
    if (product.images.length <= 1) {
      return next(new AppError("Product must have at least one image.", 400));
    }

    const match = product.images.find(
      (img) => img.publicId === decodedId || img.publicId === rawParam,
    );
    if (!match)
      return next(new AppError("Image not found on this product.", 404));

    product.images = product.images.filter(
      (img) => img.publicId !== match.publicId,
    );
    await product.save();

    enqueueImageDelete([match.publicId]).catch(() => {});
    await invalidateProductCaches({ slug: product.slug });

    const lean = await Product.findById(id).lean<Record<string, unknown>>();
    if (!lean) {
      return next(
        new AppError(
          "Product image deleted but product could not be retrieved.",
          500,
        ),
      );
    }
    sendSuccess(res, { product: leanAdminProduct(lean) });
  },
);

const MOTION_VIDEO_FOLDER = "house-of-rani/products/motion";
const PRODUCT_IMAGE_FOLDER = "house-of-rani/products";
const PREMIUM_HERO_FOLDER = "house-of-rani/products/premium-hero";

function cloudinarySignPayload(
  folder: string,
  extra: Record<string, string | number> = {},
) {
  const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
  const apiKey = process.env.CLOUDINARY_API_KEY;
  const apiSecret = process.env.CLOUDINARY_API_SECRET;
  if (!cloudName || !apiKey || !apiSecret) {
    throw new AppError("Cloudinary is not configured.", 503);
  }
  const timestamp = Math.round(Date.now() / 1000);
  const toSign = { timestamp, folder, ...extra };
  const signature = cloudinaryInstance.utils.api_sign_request(
    toSign,
    apiSecret,
  );
  return { cloudName, apiKey, timestamp, signature, folder, ...extra };
}

/** Signed params for direct browser → Cloudinary video upload (progress-friendly). */
export const getMotionVideoUploadSignature = catchAsync(
  async (_req: Request, res: Response) => {
    sendSuccess(
      res,
      cloudinarySignPayload(MOTION_VIDEO_FOLDER, {
        allowed_formats: "mp4,webm,mov",
      }),
    );
  },
);

/** Signed params for gallery images (direct-to-Cloudinary; keeps API off the upload hot path). */
export const getProductImageUploadSignature = catchAsync(
  async (_req: Request, res: Response) => {
    sendSuccess(
      res,
      cloudinarySignPayload(PRODUCT_IMAGE_FOLDER, {
        allowed_formats: "jpg,png,webp,gif",
      }),
    );
  },
);

/** Signed params for premium hero image. */
export const getPremiumHeroUploadSignature = catchAsync(
  async (_req: Request, res: Response) => {
    sendSuccess(
      res,
      cloudinarySignPayload(PREMIUM_HERO_FOLDER, {
        allowed_formats: "jpg,png,webp,gif",
      }),
    );
  },
);
