import { Request, Response } from 'express';
import catchAsync from '../../utils/catchAsync';
import { sendSuccess } from '../../utils/response';
import { getDashboardAnalyticsData } from '../../services/adminAnalyticsService';
import { getCache, setCache } from '../../services/cacheService';

const ANALYTICS_CACHE_KEY = 'analytics:dashboard';
const ANALYTICS_TTL_SECONDS = 120; // 2 minutes

export const getDashboardAnalytics = catchAsync(async (_req: Request, res: Response) => {
  // getCache already resolves to the stored value (not a Promise).
  // Using ReturnType<typeof getDashboardAnalyticsData> as the generic gives us the
  // correct resolved type; no second await needed.
  const cached = await getCache<Awaited<ReturnType<typeof getDashboardAnalyticsData>>>(ANALYTICS_CACHE_KEY);
  if (cached) {
    return sendSuccess(res, cached);
  }

  const data = await getDashboardAnalyticsData();
  // Cache result — non-critical, swallow errors
  setCache(ANALYTICS_CACHE_KEY, data, ANALYTICS_TTL_SECONDS).catch(() => {});

  sendSuccess(res, data);
});
