import { Request, Response } from "express";
import catchAsync from "../types/utils/catchAsync";
import { sendSuccess } from "../types/utils/response";
import { recordStoreVisit } from "../services/storeVisitService";
import { visitRequestMeta } from "../services/visitRequestMeta";

import { sanitizeMarketingAttribution } from "../utils/marketingAttribution";

export const recordVisit = catchAsync(async (req: Request, res: Response) => {
  const { sessionKey, path, referrer, marketingAttribution } = req.body as {
    sessionKey: string;
    path?: string;
    referrer?: string;
    marketingAttribution?: unknown;
  };
  const attribution = sanitizeMarketingAttribution(marketingAttribution);
  const meta = visitRequestMeta(req, referrer);
  if (attribution) {
    meta.marketingAttribution = {
      utmSource: attribution.utmSource,
      utmMedium: attribution.utmMedium,
      utmCampaign: attribution.utmCampaign,
      utmContent: attribution.utmContent,
      utmTerm: attribution.utmTerm,
      fbclid: attribution.fbclid,
    };
  }
  const result = await recordStoreVisit(sessionKey, path, meta);
  sendSuccess(res, result);
});
