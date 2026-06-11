import { Types } from "mongoose";
import Product from "../../models/Product";
import PurchaseInvoice from "../../models/PurchaseInvoice";
import { LOW_STOCK_ALERT_EXCLUSIVE_MAX } from "../../constants/inventory";
import { INVENTORY_QUERY_MAX_MS } from "../../constants/inventoryQuery";
import { getInventorySummaryStats } from "./inventoryCacheService";
import { recordInventoryTiming } from "./inventoryMetricsService";
import { sumMoney } from "../../types/utils/financialMath";

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
}): Promise<InventoryOverviewResult> {
  const skip = (params.page - 1) * params.limit;
  const search = params.search?.trim() ?? "";
  const category = params.category?.trim() ?? "";
  const filter = params.filter ?? "all";
  const sortParam = params.sort ?? "-updatedAt";
  //also not is isgiftable  true
  const match: Record<string, unknown> = { isActive: true };
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

  const [products, total, stockStats] = await Promise.all([
    Product.find(match)
      .sort(sort)
      .skip(skip)
      .limit(params.limit)
      .select(
        "name category fabric images variants totalStock soldCount price updatedAt hsnCode",
      )
      .lean()
      .maxTimeMS(INVENTORY_QUERY_MAX_MS),
    Product.countDocuments(match).maxTimeMS(INVENTORY_QUERY_MAX_MS),
    getInventorySummaryStats(),
  ]);

  const productsWithTurnover = products.map((p) => {
    const variants = (p.variants ?? []) as Array<{
      stock?: number;
      costPrice?: number;
      price?: number;
    }>;
    const soldCount = Number(p.soldCount ?? 0);
    const sellPrice = Number(p.price ?? 0);

    let stockUnits = 0;
    let stockCostValue = 0;
    let costWeightedSum = 0;
    let costWeightUnits = 0;

    for (const v of variants) {
      const stock = Number(v.stock ?? 0);
      const cost = Number(v.costPrice ?? 0);
      stockUnits += stock;
      stockCostValue += cost * stock;
      if (cost > 0 && stock > 0) {
        costWeightedSum += cost * stock;
        costWeightUnits += stock;
      }
    }

    const avgCost =
      costWeightUnits > 0 ?
        roundMoney(costWeightedSum / costWeightUnits)
      : roundMoney(
          variants.find(
            (v) => typeof v.costPrice === "number" && v.costPrice > 0,
          )?.costPrice ?? 0,
        );

    const estimatedRevenue = roundMoney(soldCount * sellPrice);
    const estimatedCost = roundMoney(soldCount * avgCost);
    const estimatedProfit = roundMoney(estimatedRevenue - estimatedCost);
    const marginPercent =
      sellPrice > 0 && avgCost > 0 ?
        Math.round(((sellPrice - avgCost) / sellPrice) * 100)
      : null;

    return {
      ...p,
      avgCost,
      stockValue: roundMoney(stockCostValue),
      stockUnits,
      grossRevenue: estimatedRevenue,
      grossCostOfSales: estimatedCost,
      grossProfit: estimatedProfit,
      estimatedRevenue,
      estimatedCost,
      estimatedProfit,
      marginPercent,
      turnover:
        p.totalStock > 0 ? soldCount / p.totalStock
        : soldCount > 0 ? 99
        : 0,
    };
  });

  return { products: productsWithTurnover, summary: stockStats, total };
}

function roundMoney(n: number): number {
  return Math.round(n * 100) / 100;
}

export async function getInventoryValuation() {
  const aggOptions = { maxTimeMS: INVENTORY_QUERY_MAX_MS };

  const [overall, byCategory] = await Promise.all([
    Product.aggregate([
      { $match: { isActive: true } },
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
      { $match: { isActive: true } },
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
