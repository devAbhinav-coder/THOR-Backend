/**
 * Navigation controller - powers the mega-menu and top-level navigation data.
 */

import { Request, Response } from "express";
import catchAsync from "../types/utils/catchAsync";
import { sendSuccess } from "../types/utils/response";
import {
  getMegaMenuCached,
  invalidateMegaMenuCache as invalidateMegaMenuCacheStore,
} from "../services/navigation/navigationCacheService";
import { setPublicCatalogCacheHeaders } from "../constants/publicHttpCache";

export function invalidateMegaMenuCache(): void {
  invalidateMegaMenuCacheStore();
}

export const getMegaMenu = catchAsync(async (_req: Request, res: Response) => {
  setPublicCatalogCacheHeaders(res, {
    maxAgeSec: 300,
    staleWhileRevalidateSec: 900,
  });
  const payload = await getMegaMenuCached();
  return sendSuccess(res, payload);
});
