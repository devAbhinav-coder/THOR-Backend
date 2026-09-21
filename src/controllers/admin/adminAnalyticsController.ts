import { Request, Response } from "express";
import catchAsync from "../../types/utils/catchAsync";
import { sendSuccess } from "../../types/utils/response";
import { getCachedDashboardAnalytics } from "../../services/adminAnalyticsService";

export const getDashboardAnalytics = catchAsync(
  async (_req: Request, res: Response) => {
    const data = await getCachedDashboardAnalytics();
    sendSuccess(res, data);
  },
);
