import { Request, Response } from "express";
import catchAsync from "../types/utils/catchAsync";
import { sendPaginated, sendSuccess } from "../types/utils/response";
import AppError from "../types/utils/AppError";
import {
  discoverPremiumProducts,
  getPremiumProductBySlug,
} from "../services/premium/premiumProductDiscoveryService";

/** GET /api/premium/products */
export const getPremiumProducts = catchAsync(
  async (req: Request, res: Response) => {
    const result = await discoverPremiumProducts(
      req.query as Record<string, string>,
    );
    sendPaginated(
      res,
      { products: result.products },
      {
        page: result.page,
        limit: result.limit,
        total: result.total,
        hasNextPage: result.hasNextPage,
      },
    );
  },
);

/** GET /api/premium/products/:slug */
export const getPremiumProduct = catchAsync(
  async (req: Request, res: Response) => {
    const product = await getPremiumProductBySlug(req.params.slug);
    if (!product) {
      throw new AppError("Premium product not found", 404);
    }
    sendSuccess(res, { product });
  },
);
