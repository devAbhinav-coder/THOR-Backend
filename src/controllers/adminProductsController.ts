import { Request, Response, NextFunction } from "express";
import catchAsync from "../utils/catchAsync";
import AppError from "../utils/AppError";
import { sendPaginated, sendSuccess } from "../utils/response";
import { reconcileProductJson } from "../utils/productStock";
import Product from "../models/Product";
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
    const product = await Product.findById(req.params.id).lean<Record<string, unknown>>();
    if (!product) {
      return next(new AppError("No product found with that ID.", 404));
    }
    sendSuccess(res, { product: leanProduct(product) });
  },
);

/**
 * GET /api/admin/products
 * Admin catalog (all statuses, gifting, offline-tagged) — not exposed on public /products.
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

    const { sortBy, sortOrder } = mapSortToAdvanced(
      typeof req.query.sortBy === "string" ? req.query.sortBy
      : typeof req.query.sort === "string" ? req.query.sort
      : "-createdAt",
    );

    const searchResult = await advancedSearchService.searchProducts({
      query: q,
      sortBy,
      sortOrder,
      page: listParsed.page,
      limit: listParsed.limit,
      categories,
      fabrics,
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
