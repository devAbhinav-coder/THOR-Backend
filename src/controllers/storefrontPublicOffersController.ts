import { Request, Response } from "express";
import catchAsync from "../types/utils/catchAsync";
import { sendSuccess } from "../types/utils/response";
import { setPublicCatalogCacheHeaders } from "../constants/publicHttpCache";
import { couponValidationService } from "../services/coupon/couponValidationService";
import { saleAdminService } from "../services/sale/saleAdminService";
import { getPublicPromotions } from "../services/promotion/promotionCacheService";

/** One round-trip for visit popup (replaces 3× GET /coupons|sales|promotions/public). */
export const getStorefrontPublicOffers = catchAsync(
  async (_req: Request, res: Response) => {
    setPublicCatalogCacheHeaders(res, {
      maxAgeSec: 60,
      staleWhileRevalidateSec: 180,
    });
    const [coupons, campaigns, promotions] = await Promise.all([
      couponValidationService.listPublicCoupons(),
      saleAdminService.listPublicStorefront(),
      getPublicPromotions(),
    ]);
    sendSuccess(res, { coupons, campaigns, promotions });
  },
);
