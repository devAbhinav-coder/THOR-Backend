import { getCache, setCache } from '../cacheService';
import { LOW_STOCK_ALERT_EXCLUSIVE_MAX } from '../../constants/inventory';
import { INVENTORY_SUMMARY_AGG_MAX_MS } from '../../constants/inventoryQuery';
import Product from '../../models/Product';
import { recordInventoryTiming } from './inventoryMetricsService';

export const INVENTORY_SUMMARY_CACHE_KEY = 'inventory:summary';
export const INVENTORY_SUMMARY_TTL = 60;

export function scheduleInventorySummaryInvalidation(): void {
  const started = Date.now();
  setCache(INVENTORY_SUMMARY_CACHE_KEY, null as unknown as Record<string, unknown>, 1)
    .then(() => {
      recordInventoryTiming('inventory.cache.invalidate_ms', Date.now() - started, {
        target: 'summary',
      });
    })
    .catch(() => {});
}

export async function getInventorySummaryStats(): Promise<Record<string, unknown>> {
  let stockStats = await getCache<Record<string, unknown>>(INVENTORY_SUMMARY_CACHE_KEY);
  if (stockStats) return stockStats;

  const started = Date.now();
  const [agg] = await Product.aggregate([
    { $match: { isActive: true } },
    {
      $addFields: {
        computedTotal: { $sum: '$variants.stock' },
        inventoryValue: {
          $sum: {
            $map: {
              input: '$variants',
              as: 'v',
              in: { $multiply: [{ $ifNull: ['$$v.costPrice', 0] }, '$$v.stock'] },
            },
          },
        },
      },
    },
    {
      $group: {
        _id: null,
        totalProducts: { $sum: 1 },
        totalUnits: { $sum: '$computedTotal' },
        outOfStock: { $sum: { $cond: [{ $eq: ['$computedTotal', 0] }, 1, 0] } },
        lowStock: {
          $sum: {
            $cond: [
              {
                $and: [
                  { $gt: ['$computedTotal', 0] },
                  { $lt: ['$computedTotal', LOW_STOCK_ALERT_EXCLUSIVE_MAX] },
                ],
              },
              1,
              0,
            ],
          },
        },
        totalInventoryValue: { $sum: '$inventoryValue' },
      },
    },
  ]).option({ maxTimeMS: INVENTORY_SUMMARY_AGG_MAX_MS });

  const stats: Record<string, unknown> = agg || {
    totalProducts: 0,
    totalUnits: 0,
    outOfStock: 0,
    lowStock: 0,
    totalInventoryValue: 0,
  };
  setCache(INVENTORY_SUMMARY_CACHE_KEY, stats, INVENTORY_SUMMARY_TTL).catch(() => {});
  recordInventoryTiming('inventory.cache.invalidate_ms', Date.now() - started, { phase: 'rebuild' });
  return stats;
}
