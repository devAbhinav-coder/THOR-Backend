import { Request, Response, NextFunction } from "express";
import catchAsync from "../types/utils/catchAsync";
import AppError from "../types/utils/AppError";
import { sendSuccess } from "../types/utils/response";
import { getStorefrontDeliveryEstimate } from "../services/shipping/storefrontDeliveryEstimateService";

export const getDeliveryEstimate = catchAsync(
  async (req: Request, res: Response, next: NextFunction) => {
    const pin = String(req.query.pin || "").trim();
    if (!/^\d{6}$/.test(pin)) {
      return next(new AppError("Enter a valid 6-digit pincode.", 400));
    }

    try {
      const estimate = await getStorefrontDeliveryEstimate(pin);
      sendSuccess(res, estimate);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Could not estimate delivery";
      return next(new AppError(msg, 502));
    }
  },
);
