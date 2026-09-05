import { Request, Response, NextFunction } from "express";
import catchAsync from "../types/utils/catchAsync";
import AppError from "../types/utils/AppError";
import { sendPaginated, sendSuccess } from "../types/utils/response";
import { reconcileProductJson } from "../types/utils/productStock";
import Product from "../models/Product";
import { OFFLINE_MANUAL_PRODUCT_TAG } from "../constants/offlineOrder";
import {
  parseProductListQuery,
  mapSortToAdvanced,
  normalizeSearchQuery,
} from "../services/productQueryParser";
import { listProducts } from "../services/productListService";
import { advancedSearchService } from "../services/advancedSearchService";

function leanProduct(p: Record<string, unknown>) {
  return reconcileProductJson(p as Parameters<typeof reconcileProductJson>[0]);
}

/**
 * GET /api/admin/products/:id
 * Full product document for admin edit forms (list projection is intentionally lean).
 */
export const getAdminProductById = catchAsync(
  async (req: Request, res: Response, next: NextFunction) => {
    const product = await Product.findById(req.params.id).lean<
      Record<string, unknown>
    >();
    if (!product) {
      return next(new AppError("No product found with that ID.", 404));
    }
    sendSuccess(res, { product: leanProduct(product) });
  },
);

/**
 * GET /api/admin/products
 * Admin shop catalog (all statuses, offline-tagged). Gifting products only when category=Gifting.
 */
export const getAdminProducts = catchAsync(
  async (req: Request, res: Response) => {
    const parsed = parseProductListQuery(req);
    parsed.adminScope = true;

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
  },
);

/**
 * GET /api/admin/products/search
 * Admin fuzzy search (same engine as storefront, full catalog scope).
 */
export const searchAdminProducts = catchAsync(
  async (req: Request, res: Response) => {
    const q = normalizeSearchQuery(req.query.q);
    const listParsed = parseProductListQuery(req);

    const categories =
      req.query.category ? [String(req.query.category)]
      : req.query.categories ?
        Array.isArray(req.query.categories) ?
          (req.query.categories as string[])
        : [String(req.query.categories)]
      : [];


    const colors =
      req.query.color ? [String(req.query.color)]
      : req.query.colors ?
        Array.isArray(req.query.colors) ?
          (req.query.colors as string[])
        : [String(req.query.colors)]
      : [];

    const { sortBy, sortOrder } = mapSortToAdvanced(
      typeof req.query.sortBy === "string" ? req.query.sortBy
      : typeof req.query.sort === "string" ? req.query.sort
      : "-createdAt",
    );

    // Prefer simple name/slug regex for short / typo-prone admin pickers
    // Advanced intent parsing often empties residual at 4+ chars (category/color tokens).
    const useSimple =
      req.query.simple === "true" ||
      req.query.simple === "1" ||
      req.query.mode === "name" ||
      (q.length > 0 && q.length <= 8);

    if (useSimple) {
      const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const filter: Record<string, unknown> = {
        tags: { $nin: [OFFLINE_MANUAL_PRODUCT_TAG] },
      };
      if (req.query.isActive === "true") filter.isActive = true;
      if (req.query.isActive === "false") filter.isActive = false;
      if (req.query.isPremium === "true") filter.isPremium = true;
      if (req.query.isPremium === "false") filter.isPremium = false;
      if (escaped) {
        filter.$or = [
          { name: { $regex: escaped, $options: "i" } },
          { slug: { $regex: escaped, $options: "i" } },
          { tags: { $regex: escaped, $options: "i" } },
          { fabric: { $regex: escaped, $options: "i" } },
        ];
      }
      const skip = (listParsed.page - 1) * listParsed.limit;
      const [products, total] = await Promise.all([
        Product.find(filter)
          .sort({ updatedAt: -1 })
          .skip(skip)
          .limit(listParsed.limit)
          .select(
            "name slug images price category isActive variants.size variants.color variants.colorCode variants.stock variants.sku variants.price variants.costPrice",
          )
          .lean(),
        Product.countDocuments(filter),
      ]);
      return sendPaginated(
        res,
        { products: products.map(leanProduct), searchMethod: "name_regex", cached: false },
        { page: listParsed.page, limit: listParsed.limit, total },
      );
    }

    const searchResult = await advancedSearchService.searchProducts({
      query: q,
      sortBy,
      sortOrder,
      page: listParsed.page,
      limit: listParsed.limit,
      categories,
      colors,
      minPrice: req.query.minPrice ? Number(req.query.minPrice) : undefined,
      maxPrice: req.query.maxPrice ? Number(req.query.maxPrice) : undefined,
      minRating: req.query.minRating ? Number(req.query.minRating) : undefined,
      isFeatured:
        req.query.isFeatured === "true" ? true
        : req.query.isFeatured === "false" ? false
        : undefined,
      isActive:
        req.query.isActive === "true" ? true
        : req.query.isActive === "false" ? false
        : undefined,
      adminScope: true,
      useCache: false,
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
  },
);
