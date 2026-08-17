import { Types } from "mongoose";
import Product from "../../models/Product";
import PurchaseInvoice from "../../models/PurchaseInvoice";
import { catalogInventoryProductMatch } from "../../constants/offlineOrder";
import { LOW_STOCK_ALERT_EXCLUSIVE_MAX } from "../../constants/inventory";
import { INVENTORY_QUERY_MAX_MS } from "../../constants/inventoryQuery";
import { getInventorySummaryStats } from "./inventoryCacheService";
import { recordInventoryTiming } from "./inventoryMetricsService";
import { sumMoney } from "../../types/utils/financialMath";
import {
  computeAvgCost,
  computeCatalogProfitFromVariants,
  computeEffectiveSellPrice,
  computeTurnover,
} from "./inventoryCalcHelpers";
import type { RevenuePeriod } from "../revenuePeriodService";
import {
  getMissingCostSkus,
  getPeriodMetricsByProduct,
  getPeriodMetricsBySku,
  getReorderSuggestions,
} from "./inventoryInsightsService";

function escapeRegex(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export interface InventoryOverviewResult {
  products: Record<string, unknown>[];
  summary: Record<string, unknown>;
  total: number;
}

export async function getInventoryOverview(params: {
  page: number;
  limit: number;
  search?: string;
  category?: string;
  filter?: string;
  sort?: string;
  period?: RevenuePeriod;
  year?: number;
  month?: number;
  includeReorder?: boolean;
}): Promise<InventoryOverviewResult> {
  const skip = (params.page - 1) * params.limit;
  const search = params.search?.trim() ?? "";
  const category = params.category?.trim() ?? "";
  const filter = params.filter ?? "all";
  const sortParam = params.sort ?? "-updatedAt";
  const period = params.period ?? "lifetime";
  const useOrderPeriod = period !== "lifetime";

  const match: Record<string, unknown> = catalogInventoryProductMatch();
  if (search) {
    const escapedSearch = escapeRegex(search);
    match.$or = [
      { name: { $regex: escapedSearch, $options: "i" } },
      { "variants.sku": { $regex: escapedSearch, $options: "i" } },
      { category: { $regex: escapedSearch, $options: "i" } },
    ];
  }
  if (category) match.category = category;
  if (filter === "low") {
    match.totalStock = { $gt: 0, $lt: LOW_STOCK_ALERT_EXCLUSIVE_MAX };
  } else if (filter === "out") {
    match.totalStock = 0;
  } else if (filter === "sold") {
    match.soldCount = { $gt: 0 };
  } else if (filter === "missing_cost") {
    match["variants.costPrice"] = { $in: [null, 0] };
  }

  const sortMap: Record<string, Record<string, 1 | -1>> = {
    name: { name: 1 },
    "-name": { name: -1 },
    stock: { totalStock: 1 },
    "-stock": { totalStock: -1 },
    sold: { soldCount: 1 },
    "-sold": { soldCount: -1 },
    category: { category: 1 },
    "-updatedAt": { updatedAt: -1 },
    updatedAt: { updatedAt: 1 },
  };
  const sort = sortMap[sortParam] || { updatedAt: -1 };

  const [products, total, stockStats, periodMetrics, periodSkuMetrics, missingCost, reorderSuggestions] =
    await Promise.all([
      Product.find(match)
        .sort(sort)
        .skip(skip)
        .limit(params.limit)
        .select(
          "name category fabric images variants totalStock soldCount price comparePrice updatedAt hsnCode",
        )
        .lean()
        .maxTimeMS(INVENTORY_QUERY_MAX_MS),
      Product.countDocuments(match).maxTimeMS(INVENTORY_QUERY_MAX_MS),
      getInventorySummaryStats(),
      useOrderPeriod ?
        getPeriodMetricsByProduct({
          period,
          year: params.year,
          month: params.month,
        })
      : null,
      useOrderPeriod ?
        getPeriodMetricsBySku({
          period,
          year: params.year,
          month: params.month,
        })
      : null,
      getMissingCostSkus(50),
      params.includeReorder !== false ?
        getReorderSuggestions({ limit: 15 })
      : [],
    ]);

  const productsWithTurnover = products.map((p) => {
    const variants = (p.variants ?? []) as Array<{
      sku?: string;
      stock?: number;
      costPrice?: number;
      price?: number;
      soldCount?: number;
      size?: string;
      color?: string;
    }>;
    const productId = String(p._id);
    const periodProduct = periodMetrics?.byProductId.get(productId);
    const soldCount =
      useOrderPeriod && periodProduct ?
        periodProduct.unitsSold
      : Number(p.soldCount ?? 0);
    const productPrice = Number(p.price ?? 0);

    let stockUnits = 0;
    let stockCostValue = 0;
    let variantsMissingCost = 0;

    const enrichedVariants = variants.map((v) => {
      const stock = Number(v.stock ?? 0);
      const cost = Number(v.costPrice ?? 0);
      stockUnits += stock;
      stockCostValue += cost * stock;
      if (!(cost > 0)) variantsMissingCost += 1;

      const skuMetrics =
        useOrderPeriod && periodSkuMetrics && v.sku ?
          periodSkuMetrics.bySku.get(periodSkuMetrics.skuKey(productId, v.sku))
        : undefined;

      return {
        ...v,
        soldCount:
          useOrderPeriod && skuMetrics ?
            skuMetrics.unitsSold
          : Number(v.soldCount ?? 0),
        periodRevenue: skuMetrics?.revenue,
        periodProfit: skuMetrics?.profit,
        missingCost: !(cost > 0),
      };
    });

    const avgCost = computeAvgCost(variants);
    const { sellPrice, hasVariantPriceSpread } = computeEffectiveSellPrice(
      productPrice,
      variants,
    );

    const profitMetrics =
      useOrderPeriod && periodProduct ?
        {
          grossRevenue: periodProduct.revenue,
          grossCostOfSales: periodProduct.cogs,
          grossProfit: periodProduct.profit,
          estimatedRevenue: periodProduct.revenue,
          estimatedCost: periodProduct.cogs,
          estimatedProfit: periodProduct.profit,
          marginPercent:
            periodProduct.revenue > 0 ?
              Math.round((periodProduct.profit / periodProduct.revenue) * 100)
            : null,
          periodLinesMissingCost: periodProduct.linesMissingCost,
        }
      : computeCatalogProfitFromVariants(
          productPrice,
          Number(p.soldCount ?? 0),
          enrichedVariants,
        );

    const turnover = computeTurnover(soldCount, p.totalStock);

    return {
      ...p,
      variants: enrichedVariants,
      avgCost,
      effectiveSellPrice: sellPrice,
      hasVariantPriceSpread,
      variantsMissingCost,
      stockValue: roundMoney(stockCostValue),
      stockUnits,
      ...profitMetrics,
      soldCount,
      lifetimeSoldCount: Number(p.soldCount ?? 0),
      turnover,
      isPeriodView: useOrderPeriod,
    };
  });

  const summary: Record<string, unknown> = {
    ...stockStats,
    period,
    periodLabel: periodMetrics?.bounds.label ?? "Lifetime (catalog)",
    costMethod: "weighted_average",
    missingCostSkus: missingCost.totalMissing,
    missingCostTotalSkus: missingCost.totalSkus,
    missingCostSamples: missingCost.skus.slice(0, 10),
    reorderSuggestions,
  };

  if (useOrderPeriod && periodMetrics) {
    summary.totalSoldUnits = periodMetrics.totals.unitsSold;
    summary.totalGrossRevenue = periodMetrics.totals.revenue;
    summary.totalGrossCostOfSales = periodMetrics.totals.cogs;
    summary.totalGrossProfit = periodMetrics.totals.profit;
    summary.overallMarginPercent = periodMetrics.totals.marginPercent;
    summary.totalEstimatedRevenue = periodMetrics.totals.revenue;
    summary.totalEstimatedProfit = periodMetrics.totals.profit;
    summary.periodLinesMissingCost = periodMetrics.totals.linesMissingCost;
    summary.periodOrderLines = periodMetrics.totals.orderLines;
  }

  return { products: productsWithTurnover, summary, total };
}

function roundMoney(n: number): number {
  return Math.round(n * 100) / 100;
}

export async function getInventoryValuation() {
  const aggOptions = { maxTimeMS: INVENTORY_QUERY_MAX_MS };

  const [overall, byCategory] = await Promise.all([
    Product.aggregate([
      { $match: catalogInventoryProductMatch() },
      { $unwind: "$variants" },
      {
        $group: {
          _id: null,
          totalUnits: { $sum: "$variants.stock" },
          totalCostValue: {
            $sum: {
              $multiply: [
                { $ifNull: ["$variants.costPrice", 0] },
                "$variants.stock",
              ],
            },
          },
          totalSaleValue: {
            $sum: {
              $multiply: [
                { $ifNull: ["$variants.price", "$price"] },
                "$variants.stock",
              ],
            },
          },
        },
      },
      {
        $addFields: {
          potentialMargin: {
            $cond: [
              { $gt: ["$totalSaleValue", 0] },
              {
                $round: [
                  {
                    $multiply: [
                      {
                        $divide: [
                          { $subtract: ["$totalSaleValue", "$totalCostValue"] },
                          "$totalSaleValue",
                        ],
                      },
                      100,
                    ],
                  },
                  2,
                ],
              },
              0,
            ],
          },
        },
      },
    ]).option(aggOptions),
    Product.aggregate([
      { $match: catalogInventoryProductMatch() },
      { $unwind: "$variants" },
      {
        $group: {
          _id: "$category",
          units: { $sum: "$variants.stock" },
          costValue: {
            $sum: {
              $multiply: [
                { $ifNull: ["$variants.costPrice", 0] },
                "$variants.stock",
              ],
            },
          },
          saleValue: {
            $sum: {
              $multiply: [
                { $ifNull: ["$variants.price", "$price"] },
                "$variants.stock",
              ],
            },
          },
          products: { $addToSet: "$_id" },
        },
      },
      {
        $project: {
          category: "$_id",
          units: 1,
          costValue: 1,
          saleValue: 1,
          productCount: { $size: "$products" },
        },
      },
      { $sort: { costValue: -1 } },
    ]).option(aggOptions),
  ]);

  const o = overall[0] || {
    totalUnits: 0,
    totalCostValue: 0,
    totalSaleValue: 0,
    potentialMargin: 0,
  };

  return { overall: o, byCategory };
}

export async function getGstPurchaseSummary(params: {
  year: number;
  month?: string;
  quarter?: string;
}) {
  const started = Date.now();
  const { year, month: monthParam, quarter: quarterParam } = params;

  const startDate = new Date(`${year}-01-01T00:00:00.000Z`);
  const endDate = new Date(`${year + 1}-01-01T00:00:00.000Z`);

  const dateFilter: Record<string, Date> = { $gte: startDate, $lt: endDate };

  if (monthParam && monthParam !== "all") {
    const m = parseInt(monthParam, 10);
    const mStart = new Date(year, m - 1, 1);
    const mEnd = new Date(year, m, 1);
    dateFilter.$gte = mStart;
    dateFilter.$lt = mEnd;
  } else if (quarterParam && quarterParam !== "all") {
    const q = parseInt(quarterParam, 10);
    const qStart = new Date(year, (q - 1) * 3, 1);
    const qEnd = new Date(year, q * 3, 1);
    dateFilter.$gte = qStart;
    dateFilter.$lt = qEnd;
  }

  const invoiceMatch = { invoiceDate: dateFilter, status: { $ne: "voided" } };
  const aggOptions = { maxTimeMS: INVENTORY_QUERY_MAX_MS };

  const [bySupplier, monthly] = await Promise.all([
    PurchaseInvoice.aggregate([
      { $match: invoiceMatch },
      {
        $group: {
          _id: {
            gstin: { $ifNull: ["$supplierGstin", "UNREGISTERED"] },
            name: "$supplierName",
          },
          invoiceCount: { $sum: 1 },
          totalTaxable: { $sum: "$totalTaxable" },
          totalCgst: { $sum: "$totalCgst" },
          totalSgst: { $sum: "$totalSgst" },
          totalIgst: { $sum: "$totalIgst" },
          totalTax: { $sum: "$totalTax" },
          grandTotal: { $sum: "$grandTotal" },
        },
      },
      {
        $project: {
          _id: 0,
          gstin: "$_id.gstin",
          supplierName: "$_id.name",
          invoiceCount: 1,
          totalTaxable: 1,
          totalCgst: 1,
          totalSgst: 1,
          totalIgst: 1,
          totalTax: 1,
          grandTotal: 1,
        },
      },
      { $sort: { grandTotal: -1 } },
    ]).option(aggOptions),
    PurchaseInvoice.aggregate([
      {
        $match: {
          invoiceDate: { $gte: startDate, $lt: endDate },
          status: { $ne: "voided" },
        },
      },
      {
        $group: {
          _id: {
            year: { $year: "$invoiceDate" },
            month: { $month: "$invoiceDate" },
          },
          invoiceCount: { $sum: 1 },
          totalTaxable: { $sum: "$totalTaxable" },
          totalCgst: { $sum: "$totalCgst" },
          totalSgst: { $sum: "$totalSgst" },
          totalIgst: { $sum: "$totalIgst" },
          totalTax: { $sum: "$totalTax" },
          grandTotal: { $sum: "$grandTotal" },
        },
      },
      { $sort: { "_id.year": 1, "_id.month": 1 } },
    ]).option(aggOptions),
  ]);

  const totals = bySupplier.reduce(
    (acc, s) => ({
      taxable: sumMoney([acc.taxable, s.totalTaxable]),
      cgst: sumMoney([acc.cgst, s.totalCgst]),
      sgst: sumMoney([acc.sgst, s.totalSgst]),
      igst: sumMoney([acc.igst, s.totalIgst]),
      tax: sumMoney([acc.tax, s.totalTax]),
      grand: sumMoney([acc.grand, s.grandTotal]),
    }),
    { taxable: 0, cgst: 0, sgst: 0, igst: 0, tax: 0, grand: 0 },
  );

  recordInventoryTiming("inventory.gst_summary.ms", Date.now() - started, {
    year,
  });

  return { bySupplier, monthly, totals, year };
}

/** Full catalog export rows for CSV (active products, all variants). */
export async function getInventoryExportRows(): Promise<Record<string, unknown>[]> {
  const products = await Product.find(catalogInventoryProductMatch())
    .select("name category price totalStock soldCount variants hsnCode")
    .sort({ name: 1 })
    .lean()
    .maxTimeMS(INVENTORY_QUERY_MAX_MS);

  const rows: Record<string, unknown>[] = [];
  for (const p of products) {
    for (const v of (p.variants ?? []) as Array<{
      sku: string;
      size?: string;
      color?: string;
      stock?: number;
      price?: number;
      costPrice?: number;
      soldCount?: number;
    }>) {
      rows.push({
        productName: p.name,
        category: p.category,
        sku: v.sku,
        size: v.size ?? "",
        color: v.color ?? "",
        stock: v.stock ?? 0,
        mrp: v.price ?? p.price,
        costPrice: v.costPrice ?? "",
        soldCountSku: v.soldCount ?? 0,
        soldCountProduct: p.soldCount ?? 0,
        hsnCode: p.hsnCode ?? "",
        stockValue: roundMoney((v.costPrice ?? 0) * (v.stock ?? 0)),
      });
    }
  }
  return rows;
}
