import { getCache, setCache } from "../cacheService";
import { LOW_STOCK_ALERT_EXCLUSIVE_MAX } from "../../constants/inventory";
import { INVENTORY_SUMMARY_AGG_MAX_MS } from "../../constants/inventoryQuery";
import Product from "../../models/Product";
import { recordInventoryTiming } from "./inventoryMetricsService";
import { roundMoney } from "../../types/utils/financialMath";

export const INVENTORY_SUMMARY_CACHE_KEY = "inventory:summary:v2";
export const INVENTORY_SUMMARY_TTL = 60;

export function scheduleInventorySummaryInvalidation(): void {
  const started = Date.now();
  setCache(
    INVENTORY_SUMMARY_CACHE_KEY,
    null as unknown as Record<string, unknown>,
    1,
  )
    .then(() => {
      recordInventoryTiming(
        "inventory.cache.invalidate_ms",
        Date.now() - started,
        {
          target: "summary",
        },
      );
    })
    .catch(() => {});
}

export async function getInventorySummaryStats(): Promise<
  Record<string, unknown>
> {
  let stockStats = await getCache<Record<string, unknown>>(
    INVENTORY_SUMMARY_CACHE_KEY,
  );
  if (stockStats) return stockStats;

  const started = Date.now();
  const aggRows = await Product.aggregate([
    { $match: { isActive: true } },
    {
      $addFields: {
        computedTotal: { $sum: "$variants.stock" },
        inventoryValue: {
          $sum: {
            $map: {
              input: "$variants",
              as: "v",
              in: {
                $multiply: [{ $ifNull: ["$$v.costPrice", 0] }, "$$v.stock"],
              },
            },
          },
        },
        saleValueOnHand: {
          $sum: {
            $map: {
              input: "$variants",
              as: "v",
              in: {
                $multiply: [{ $ifNull: ["$$v.price", "$price"] }, "$$v.stock"],
              },
            },
          },
        },
        costWeightedSum: {
          $sum: {
            $map: {
              input: "$variants",
              as: "v",
              in: {
                $cond: [
                  {
                    $and: [
                      { $gt: ["$$v.stock", 0] },
                      { $gt: [{ $ifNull: ["$$v.costPrice", 0] }, 0] },
                    ],
                  },
                  { $multiply: ["$$v.costPrice", "$$v.stock"] },
                  0,
                ],
              },
            },
          },
        },
        costWeightUnits: {
          $sum: {
            $map: {
              input: "$variants",
              as: "v",
              in: {
                $cond: [
                  {
                    $and: [
                      { $gt: ["$$v.stock", 0] },
                      { $gt: [{ $ifNull: ["$$v.costPrice", 0] }, 0] },
                    ],
                  },
                  "$$v.stock",
                  0,
                ],
              },
            },
          },
        },
        firstVariantCost: {
          $first: {
            $map: {
              input: {
                $filter: {
                  input: "$variants",
                  as: "v",
                  cond: { $gt: [{ $ifNull: ["$$v.costPrice", 0] }, 0] },
                },
              },
              as: "vc",
              in: "$$vc.costPrice",
            },
          },
        },
        soldUnits: { $ifNull: ["$soldCount", 0] },
        sellPrice: { $ifNull: ["$price", 0] },
      },
    },
    {
      $addFields: {
        avgCost: {
          $cond: [
            { $gt: ["$costWeightUnits", 0] },
            { $divide: ["$costWeightedSum", "$costWeightUnits"] },
            { $ifNull: ["$firstVariantCost", 0] },
          ],
        },
      },
    },
    {
      $addFields: {
        grossRevenue: { $multiply: ["$soldUnits", "$sellPrice"] },
        grossCostOfSales: { $multiply: ["$soldUnits", "$avgCost"] },
      },
    },
    {
      $addFields: {
        grossProfit: { $subtract: ["$grossRevenue", "$grossCostOfSales"] },
      },
    },
    {
      $group: {
        _id: null,
        totalProducts: { $sum: 1 },
        totalUnits: { $sum: "$computedTotal" },
        outOfStock: { $sum: { $cond: [{ $eq: ["$computedTotal", 0] }, 1, 0] } },
        lowStock: {
          $sum: {
            $cond: [
              {
                $and: [
                  { $gt: ["$computedTotal", 0] },
                  { $lt: ["$computedTotal", LOW_STOCK_ALERT_EXCLUSIVE_MAX] },
                ],
              },
              1,
              0,
            ],
          },
        },
        totalInventoryValue: { $sum: "$inventoryValue" },
        totalSaleValueOnHand: { $sum: "$saleValueOnHand" },
        totalSoldUnits: { $sum: "$soldUnits" },
        totalGrossRevenue: { $sum: "$grossRevenue" },
        totalGrossCostOfSales: { $sum: "$grossCostOfSales" },
        totalGrossProfit: { $sum: "$grossProfit" },
        productsWithSales: {
          $sum: { $cond: [{ $gt: ["$soldUnits", 0] }, 1, 0] },
        },
      },
    },
  ]).option({ maxTimeMS: INVENTORY_SUMMARY_AGG_MAX_MS });

  const raw = aggRows[0] as Record<string, number> | undefined;
  const totalGrossRevenue = roundMoney(raw?.totalGrossRevenue ?? 0);
  const totalGrossProfit = roundMoney(raw?.totalGrossProfit ?? 0);
  const totalGrossCostOfSales = roundMoney(raw?.totalGrossCostOfSales ?? 0);
  const overallMarginPercent =
    totalGrossRevenue > 0 ?
      Math.round((totalGrossProfit / totalGrossRevenue) * 100)
    : 0;

  const stats: Record<string, unknown> =
    raw ?
      {
        totalProducts: raw.totalProducts ?? 0,
        totalUnits: raw.totalUnits ?? 0,
        outOfStock: raw.outOfStock ?? 0,
        lowStock: raw.lowStock ?? 0,
        totalInventoryValue: roundMoney(raw.totalInventoryValue ?? 0),
        totalSaleValueOnHand: roundMoney(raw.totalSaleValueOnHand ?? 0),
        totalSoldUnits: raw.totalSoldUnits ?? 0,
        totalGrossRevenue,
        totalGrossCostOfSales,
        totalGrossProfit,
        overallMarginPercent,
        productsWithSales: raw.productsWithSales ?? 0,
        // Legacy aliases for frontend
        totalEstimatedRevenue: totalGrossRevenue,
        totalEstimatedProfit: totalGrossProfit,
      }
    : {
        totalProducts: 0,
        totalUnits: 0,
        outOfStock: 0,
        lowStock: 0,
        totalInventoryValue: 0,
        totalSaleValueOnHand: 0,
        totalSoldUnits: 0,
        totalGrossRevenue: 0,
        totalGrossCostOfSales: 0,
        totalGrossProfit: 0,
        overallMarginPercent: 0,
        productsWithSales: 0,
        totalEstimatedRevenue: 0,
        totalEstimatedProfit: 0,
      };
  setCache(INVENTORY_SUMMARY_CACHE_KEY, stats, INVENTORY_SUMMARY_TTL).catch(
    () => {},
  );
  recordInventoryTiming("inventory.cache.invalidate_ms", Date.now() - started, {
    phase: "rebuild",
  });
  return stats;
}
