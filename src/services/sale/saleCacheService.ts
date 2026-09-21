import SaleCampaign from '../../models/SaleCampaign';
import { deleteCache } from '../cacheService';
import type { SaleCampaignLike } from './salePriceService';
import { isWithinValidityWindow } from '../coupon/couponBusinessRules';
import { cachedFetch } from '../cache/cachedFetch';

const ACTIVE_SALES_KEY = 'cache:sales:active:env';
const ACTIVE_SOFT_TTL = Number(process.env.SALE_ACTIVE_CACHE_TTL_SEC || 120);
const ACTIVE_HARD_TTL = Math.max(ACTIVE_SOFT_TTL * 3, ACTIVE_SOFT_TTL + 60);
const QUERY_MAX_MS = Number(process.env.SALE_QUERY_MAX_MS || 5000);

function filterActiveCampaigns(
  docs: SaleCampaignLike[],
  now: Date,
): SaleCampaignLike[] {
  return docs.filter((c) =>
    isWithinValidityWindow(new Date(c.startDate), new Date(c.endDate), now),
  );
}

async function loadActiveSaleCampaignsFromDb(
  now: Date,
): Promise<SaleCampaignLike[]> {
  const docs = await SaleCampaign.find({
    isActive: true,
    deletedAt: null,
    archivedAt: null,
    startDate: { $lte: now },
    endDate: { $gte: now },
  })
    .maxTimeMS(QUERY_MAX_MS)
    .lean<SaleCampaignLike[]>();

  return filterActiveCampaigns(docs, now);
}

export async function getActiveSaleCampaigns(
  now = new Date(),
): Promise<SaleCampaignLike[]> {
  const campaigns = await cachedFetch({
    key: ACTIVE_SALES_KEY,
    softTtlSec: ACTIVE_SOFT_TTL,
    hardTtlSec: ACTIVE_HARD_TTL,
    fetchFresh: () => loadActiveSaleCampaignsFromDb(now),
  });

  return filterActiveCampaigns(campaigns, now);
}

export async function invalidateSaleCaches(): Promise<void> {
  await deleteCache(ACTIVE_SALES_KEY);
}
