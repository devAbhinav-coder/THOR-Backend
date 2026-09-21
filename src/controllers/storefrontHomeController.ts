import { Request, Response } from "express";
import catchAsync from "../types/utils/catchAsync";
import { sendSuccess } from "../types/utils/response";
import { setPublicCatalogCacheHeaders } from "../constants/publicHttpCache";
import { loadStorefrontHomePageBundle } from "../services/storefront/homePageBundleService";

export const getStorefrontHomeBundle = catchAsync(
  async (_req: Request, res: Response) => {
    setPublicCatalogCacheHeaders(res, {
      maxAgeSec: 60,
      staleWhileRevalidateSec: 180,
    });
    const bundle = await loadStorefrontHomePageBundle();
    sendSuccess(res, bundle);
  },
);
