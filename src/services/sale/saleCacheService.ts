import SaleCampaign from '../../models/SaleCampaign';
import { getCache, setCache, deleteCache } from '../cacheService';
import type { SaleCampaignLike } from './salePriceService';
import { isWithinValidityWindow } from '../coupon/couponBusinessRules';

const ACTIVE_SALES_KEY = 'cache:sales:active';
const ACTIVE_TTL = Number(process.env.SALE_ACTIVE_CACHE_TTL_SEC || 120);
const QUERY_MAX_MS = Number(process.env.SALE_QUERY_MAX_MS || 5000);

export async function getActiveSaleCampaigns(
  now = new Date()
): Promise<SaleCampaignLike[]> {
  const cached = await getCache<SaleCampaignLike[]>(ACTIVE_SALES_KEY);
  if (cached) {
    return cached.filter((c) =>
      isWithinValidityWindow(new Date(c.startDate), new Date(c.endDate), now)
    );
  }

  const docs = await SaleCampaign.find({
    isActive: true,
    deletedAt: null,
    archivedAt: null,
    startDate: { $lte: now },
    endDate: { $gte: now },
  })
    .maxTimeMS(QUERY_MAX_MS)
    .lean<SaleCampaignLike[]>();

  const active = docs.filter((c) =>
    isWithinValidityWindow(c.startDate, c.endDate, now)
  );
  await setCache(ACTIVE_SALES_KEY, active, ACTIVE_TTL);
  return active;
}

export async function invalidateSaleCaches(): Promise<void> {
  await deleteCache(ACTIVE_SALES_KEY);
}
