import Promotion from '../../models/Promotion';
import { getCache, setCache, deleteCache } from '../cacheService';
import type { PromotionLike } from './promotionBusinessRules';
import { isWithinValidityWindow } from './promotionBusinessRules';

const ACTIVE_KEY = 'cache:promotions:active';
const ACTIVE_TTL = Number(process.env.PROMOTION_ACTIVE_CACHE_TTL_SEC || 120);
const QUERY_MAX_MS = Number(process.env.PROMOTION_QUERY_MAX_MS || 5000);

export async function getActivePromotions(now = new Date()): Promise<PromotionLike[]> {
  const cached = await getCache<PromotionLike[]>(ACTIVE_KEY);
  if (cached) {
    return cached.filter((p) =>
      isWithinValidityWindow(new Date(p.startDate), new Date(p.endDate), now),
    );
  }

  const docs = await Promotion.find({
    isActive: true,
    deletedAt: null,
    archivedAt: null,
    startDate: { $lte: now },
    endDate: { $gte: now },
  })
    .sort('-priority -createdAt')
    .maxTimeMS(QUERY_MAX_MS)
    .lean<PromotionLike[]>();

  const active = docs.filter((p) =>
    isWithinValidityWindow(p.startDate, p.endDate, now),
  );
  await setCache(ACTIVE_KEY, active, ACTIVE_TTL);
  return active;
}

export async function getPublicPromotions(now = new Date()): Promise<PromotionLike[]> {
  const all = await getActivePromotions(now);
  return all.filter((p) => p.showOnStorefront !== false);
}

export async function invalidatePromotionCaches(): Promise<void> {
  await deleteCache(ACTIVE_KEY);
}
