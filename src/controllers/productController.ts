import { Request, Response, NextFunction } from "express";
import Product from "../models/Product";
import AppError from "../utils/AppError";
import catchAsync from "../utils/catchAsync";
import APIFeatures from "../utils/apiFeatures";
import { IProduct } from "../types";
import { reconcileProductJson, sumVariantStocks } from "../utils/productStock";
import { getCache, setCache, deleteCache } from "../services/cacheService";
import { productRepository } from "../repositories/productRepository";
import { sendPaginated, sendSuccess } from "../utils/response";
import { safeJsonParse } from "../utils/safeJson";
import { enqueueImageDelete } from "../queues/imageQueue";
import { CacheMutex } from "../utils/cacheMutex";
import { advancedSearchService } from "../services/advancedSearchService";
import {
  normalizeSearchQuery,
  parseProductListQuery,
  mapSortToAdvanced,
} from "../services/productQueryParser";
import { listProducts } from "../services/productListService";
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
import { invalidateGiftingProductCache } from "../services/gifting/giftingProductDiscoveryService";
const PDP_CACHE_TTL = 600;
const FILTERS_CACHE_TTL = 300;

function leanProduct(p: Record<string, unknown>) {
  return reconcileProductJson(p as Parameters<typeof reconcileProductJson>[0]);
}

function minRatingMongoFilter(query: Request["query"]): Record<string, unknown> {
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

export const getAllProducts = catchAsync(async (req: Request, res: Response) => {
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
    },
    {
      page: result.page,
      limit: result.limit,
      total: result.total,
      hasNextPage: result.hasNextPage,
    },
  );
});

// ─── searchProducts ────────────────────────────────────────────────────────────

export const searchProducts = catchAsync(async (req: Request, res: Response) => {
  const q = normalizeSearchQuery(req.query.q);
  const categories = req.query.category ?
      [String(req.query.category)]
    : req.query.categories ?
      (Array.isArray(req.query.categories) ?
        (req.query.categories as string[])
      : [String(req.query.categories)])
    : [];
  const fabrics = req.query.fabric ?
      [String(req.query.fabric)]
    : req.query.fabrics ?
      (Array.isArray(req.query.fabrics) ?
        (req.query.fabrics as string[])
      : [String(req.query.fabrics)])
    : [];

  const page = parseProductListQuery(req).page;
  const limit = parseProductListQuery(req).limit;
  const { sortBy, sortOrder } = mapSortToAdvanced(
    typeof req.query.sortBy === "string" ? req.query.sortBy
    : typeof req.query.sort === "string" ? req.query.sort
    : "relevance",
  );

  const searchResult = await advancedSearchService.searchProducts({
    query: q,
    sortBy,
    sortOrder,
    page,
    limit,
    categories,
    fabrics,
    minPrice: req.query.minPrice ? Number(req.query.minPrice) : undefined,
    maxPrice: req.query.maxPrice ? Number(req.query.maxPrice) : undefined,
    minRating: req.query.minRating ? Number(req.query.minRating) : undefined,
    isFeatured:
      req.query.isFeatured === "true" ? true
      : req.query.isFeatured === "false" ? false
      : undefined,
    adminScope: false,
    useCache: true,
  });

  sendPaginated(
    res,
    {
      products: searchResult.products.map(leanProduct),
      searchMethod: searchResult.searchMethod,
      cached: searchResult.cached,
    },
    {
      page: searchResult.page,
      limit: searchResult.limit,
      total: searchResult.total,
    },
  );
});

export const autocompleteSearch = catchAsync(
  async (req: Request, res: Response) => {
    const q = normalizeSearchQuery(req.query.q);
    const limit = Math.min(
      Math.max(1, Number(req.query.limit) || 5),
      10,
    );

    if (!q) {
      return sendSuccess(res, { suggestions: [], query: "" });
    }

    const suggestions = await advancedSearchService.autocomplete(q, limit);
    sendSuccess(res, { suggestions, query: q });
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
    const limit = Math.min(Math.max(1, Number(req.query.limit) || 10), 20);
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
    if (cached) return sendSuccess(res, { product: cached });

    const mutex = new CacheMutex(cacheKey, { ttlMs: 5000 });
    const product = await mutex.withLock(async () => {
      const recheck = await getCache<Record<string, unknown>>(cacheKey);
      if (recheck) return recheck;

      const dbProduct = await Product.findOne({
        slug,
        isActive: true,
        tags: { $nin: [OFFLINE_MANUAL_PRODUCT_TAG] },
      }).lean<Record<string, unknown>>();

      if (!dbProduct) return null;

      const transformed = leanProduct(dbProduct);
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
      return sendSuccess(res, { product: leanProduct(dbProduct) });
    }

    sendSuccess(res, { product });
  },
);

export const getFeaturedProducts = catchAsync(
  async (_req: Request, res: Response) => {
    const v = await getProductCacheVersion();
    const cacheKey = featuredCacheKey(v);
    const cached = await getCache<Record<string, unknown>[]>(cacheKey);
    if (cached) {
      return sendSuccess(res, { products: cached.map(leanProduct) });
    }
    const products = await productRepository.findFeatured();
    const transformed = products.map(leanProduct);
    setCache(cacheKey, transformed, 120).catch(() => {});
    sendSuccess(res, { products: transformed });
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

    sendPaginated(
      res,
      { products: products.map(leanProduct) },
      { page: features.getPage(), limit: features.getLimit(), total: totalCount },
    );
  },
);

export const getFilterOptions = catchAsync(
  async (_req: Request, res: Response) => {
    const v = await getProductCacheVersion();
    const cacheKey = filtersCacheKey(v);
    const cached = await getCache<{
      categories: string[];
      fabrics: string[];
      priceRange: { minPrice: number; maxPrice: number };
    }>(cacheKey);
    if (cached) return sendSuccess(res, cached);

    const matchFilter = {
      isActive: true,
      category: { $ne: "Gifting" },
      tags: { $nin: [OFFLINE_MANUAL_PRODUCT_TAG] },
    };

    const [agg] = await Product.aggregate<{
      categories: string[];
      fabrics: string[];
      minPrice: number;
      maxPrice: number;
    }>([
      { $match: matchFilter },
      {
        $group: {
          _id: null,
          categories: { $addToSet: "$category" },
          fabrics: { $addToSet: "$fabric" },
          minPrice: { $min: "$price" },
          maxPrice: { $max: "$price" },
        },
      },
    ]).option({ maxTimeMS: 4000 });

    const result = {
      categories: (agg?.categories ?? []).filter(Boolean).sort() as string[],
      fabrics: (agg?.fabrics ?? []).filter(Boolean).sort() as string[],
      priceRange: {
        minPrice: agg?.minPrice ?? 0,
        maxPrice: agg?.maxPrice ?? 100000,
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

    if (!uploadedImages?.length) {
      return next(new AppError("Please upload at least one product image.", 400));
    }
    if (uploadedImages.length > 7) {
      return next(new AppError("A product can have at most 7 images.", 400));
    }

    const images = uploadedImages.map((img, index) => ({
      url: img.url,
      publicId: img.publicId,
      alt: `${req.body.name} - Image ${index + 1}`,
    }));

    const variantsParsed = safeJsonParse(
      req.body.variants,
      req.body.variants,
      "variants",
    );

    const productData = {
      ...req.body,
      images,
      variants: variantsParsed,
      tags: safeJsonParse(req.body.tags, req.body.tags || [], "tags"),
      price: Number(req.body.price),
      comparePrice: req.body.comparePrice ?
        Number(req.body.comparePrice)
      : undefined,
      isFeatured: req.body.isFeatured === "true" || req.body.isFeatured === true,
      isActive: req.body.isActive !== "false" && req.body.isActive !== false,
      isGiftable: req.body.isGiftable === "true" || req.body.isGiftable === true,
      isCustomizable:
        req.body.isCustomizable === "true" || req.body.isCustomizable === true,
      minOrderQty: req.body.minOrderQty ? Number(req.body.minOrderQty) : 1,
      giftOccasions: safeJsonParse(
        req.body.giftOccasions,
        req.body.giftOccasions || [],
        "giftOccasions",
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
    };
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

    const lean = await Product.findById(product._id).lean<Record<string, unknown>>();
    if (!lean) {
      return next(new AppError("Product created but could not be retrieved.", 500));
    }
    sendSuccess(res, { product: leanProduct(lean) }, "Product created", 201);
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
    if (uploadedImages?.length) {
      const combined = currentProduct.images.length + uploadedImages.length;
      if (combined > 7) {
        return next(
          new AppError(
            `Cannot add ${uploadedImages.length} image(s): product already has ${currentProduct.images.length} (max 7 total).`,
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
      updateData.variants = safeJsonParse(
        req.body.variants,
        req.body.variants,
        "variants",
      );
    }
    if (req.body.tags && typeof req.body.tags === "string") {
      updateData.tags = safeJsonParse(req.body.tags, req.body.tags, "tags");
    }
    if (req.body.giftOccasions !== undefined) {
      updateData.giftOccasions = safeJsonParse(
        req.body.giftOccasions,
        req.body.giftOccasions,
        "giftOccasions",
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
        typeof req.body.hsnCode === "string" ? req.body.hsnCode.trim() : req.body.hsnCode;
    }
    if (req.body.price !== undefined) {
      updateData.price = Number(req.body.price);
    }
    if (req.body.comparePrice !== undefined) {
      updateData.comparePrice = Number(req.body.comparePrice);
    }

    delete updateData.updatedAt;
    delete updateData.totalStock;
    if (updateData.category === "Gifting" || currentProduct.category === "Gifting") {
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

    sendSuccess(res, { product: leanProduct(updatedProduct) }, "Product updated");
  },
);

export const deleteProduct = catchAsync(
  async (req: Request, res: Response, next: NextFunction) => {
    const product = await Product.findById(req.params.id);
    if (!product) return next(new AppError("No product found with that ID.", 404));

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
    if (!product) return next(new AppError("No product found with that ID.", 404));
    if (product.images.length <= 1) {
      return next(new AppError("Product must have at least one image.", 400));
    }

    const match = product.images.find(
      (img) => img.publicId === decodedId || img.publicId === rawParam,
    );
    if (!match) return next(new AppError("Image not found on this product.", 404));

    product.images = product.images.filter(
      (img) => img.publicId !== match.publicId,
    );
    await product.save();

    enqueueImageDelete([match.publicId]).catch(() => {});
    await invalidateProductCaches({ slug: product.slug });

    const lean = await Product.findById(id).lean<Record<string, unknown>>();
    if (!lean) {
      return next(
        new AppError("Product image deleted but product could not be retrieved.", 500),
      );
    }
    sendSuccess(res, { product: leanProduct(lean) });
  },
);
