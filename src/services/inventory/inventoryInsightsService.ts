import Order from "../../models/Order";
import Product from "../../models/Product";
import Category from "../../models/Category";
import { LOW_STOCK_ALERT_EXCLUSIVE_MAX } from "../../constants/inventory";
import { INVENTORY_QUERY_MAX_MS } from "../../constants/inventoryQuery";
import {
  resolveRevenuePeriodBounds,
  type RevenuePeriod,
} from "../revenuePeriodService";
import { roundMoney } from "../../types/utils/financialMath";
import {
  catalogInventoryProductMatch,
  isLegacyOfflineManualPlaceholderImage,
  OFFLINE_MANUAL_VARIANT_SKU,
  resolveOfflineManualLineImage,
} from "../../constants/offlineOrder";
import { OFFLINE_MANUAL_ITEM_SLUG } from "../orderProfitAggregationHelpers";
import { paidOrderLineProfitStages } from "../orderProfitAggregationHelpers";

export interface PeriodSkuMetrics {
  productId: string;
  sku: string;
  unitsSold: number;
  revenue: number;
  cogs: number;
  profit: number;
  linesMissingCost: number;
}

export interface ReorderSuggestion {
  productId: string;
  productName: string;
  sku: string;
  size?: string;
  color?: string;
  currentStock: number;
  unitsSoldInPeriod: number;
  avgDailySales: number;
  suggestedReorderQty: number;
  priorityScore: number;
  missingCost: boolean;
}

export interface MissingCostSku {
  productId: string;
  productName: string;
  sku: string;
  size?: string;
  color?: string;
  stock: number;
  soldCount: number;
}

function paidLineStages(dateMatch: Record<string, unknown> = {}) {
  return paidOrderLineProfitStages(dateMatch);
}

export async function getPeriodMetricsByProduct(params: {
  period: RevenuePeriod;
  year?: number;
  month?: number;
}) {
  const bounds = resolveRevenuePeriodBounds(
    params.period,
    params.year,
    params.month,
  );
  const dateMatch =
    bounds.start ?
      { createdAt: { $gte: bounds.start, $lt: bounds.end } }
    : {};

  const rows = await Order.aggregate([
    ...paidLineStages(dateMatch),
    {
      $group: {
        _id: "$items.product",
        unitsSold: { $sum: "$items.quantity" },
        revenue: { $sum: "$lineRevenue" },
        cogs: { $sum: "$lineCogs" },
        profit: { $sum: "$lineProfit" },
        linesMissingCost: {
          $sum: { $cond: ["$hasCostData", 0, 1] },
        },
        orderLines: { $sum: 1 },
      },
    },
  ]).option({ maxTimeMS: INVENTORY_QUERY_MAX_MS });

  const byProductId = new Map<
    string,
    {
      unitsSold: number;
      revenue: number;
      cogs: number;
      profit: number;
      linesMissingCost: number;
      orderLines: number;
    }
  >();

  for (const r of rows) {
    if (!r._id) continue;
    byProductId.set(String(r._id), {
      unitsSold: r.unitsSold ?? 0,
      revenue: roundMoney(r.revenue ?? 0),
      cogs: roundMoney(r.cogs ?? 0),
      profit: roundMoney(r.profit ?? 0),
      linesMissingCost: r.linesMissingCost ?? 0,
      orderLines: r.orderLines ?? 0,
    });
  }

  const totals = rows.reduce(
    (acc, r) => ({
      unitsSold: acc.unitsSold + (r.unitsSold ?? 0),
      revenue: acc.revenue + (r.revenue ?? 0),
      cogs: acc.cogs + (r.cogs ?? 0),
      profit: acc.profit + (r.profit ?? 0),
      linesMissingCost: acc.linesMissingCost + (r.linesMissingCost ?? 0),
      orderLines: acc.orderLines + (r.orderLines ?? 0),
    }),
    {
      unitsSold: 0,
      revenue: 0,
      cogs: 0,
      profit: 0,
      linesMissingCost: 0,
      orderLines: 0,
    },
  );

  return {
    bounds,
    byProductId,
    totals: {
      unitsSold: totals.unitsSold,
      revenue: roundMoney(totals.revenue),
      cogs: roundMoney(totals.cogs),
      profit: roundMoney(totals.profit),
      linesMissingCost: totals.linesMissingCost,
      orderLines: totals.orderLines,
      marginPercent:
        totals.revenue > 0 ?
          Math.round((totals.profit / totals.revenue) * 100)
        : 0,
    },
  };
}

export async function getPeriodMetricsBySku(params: {
  period: RevenuePeriod;
  year?: number;
  month?: number;
}) {
  const bounds = resolveRevenuePeriodBounds(
    params.period,
    params.year,
    params.month,
  );
  const dateMatch =
    bounds.start ?
      { createdAt: { $gte: bounds.start, $lt: bounds.end } }
    : {};

  const rows = await Order.aggregate([
    ...paidLineStages(dateMatch),
    {
      $group: {
        _id: {
          productId: "$items.product",
          sku: "$items.variant.sku",
        },
        unitsSold: { $sum: "$items.quantity" },
        revenue: { $sum: "$lineRevenue" },
        cogs: { $sum: "$lineCogs" },
        profit: { $sum: "$lineProfit" },
        linesMissingCost: {
          $sum: { $cond: ["$hasCostData", 0, 1] },
        },
      },
    },
  ]).option({ maxTimeMS: INVENTORY_QUERY_MAX_MS });

  const key = (productId: string, sku: string) => `${productId}:${sku}`;
  const bySku = new Map<string, PeriodSkuMetrics>();

  for (const r of rows) {
    const productId = String(r._id?.productId ?? "");
    const sku = String(r._id?.sku ?? "");
    if (!productId || !sku) continue;
    bySku.set(key(productId, sku), {
      productId,
      sku,
      unitsSold: r.unitsSold ?? 0,
      revenue: roundMoney(r.revenue ?? 0),
      cogs: roundMoney(r.cogs ?? 0),
      profit: roundMoney(r.profit ?? 0),
      linesMissingCost: r.linesMissingCost ?? 0,
    });
  }

  return { bounds, bySku, skuKey: key };
}

export async function getMissingCostSkus(limit = 200): Promise<{
  skus: MissingCostSku[];
  totalMissing: number;
  totalSkus: number;
}> {
  const products = await Product.find(catalogInventoryProductMatch())
    .select(
      "name variants.sku variants.size variants.color variants.stock variants.costPrice variants.soldCount",
    )
    .lean()
    .maxTimeMS(INVENTORY_QUERY_MAX_MS);

  const missing: MissingCostSku[] = [];
  let totalSkus = 0;

  for (const p of products) {
    for (const v of (p.variants ?? []) as Array<{
      sku: string;
      size?: string;
      color?: string;
      stock?: number;
      costPrice?: number;
      soldCount?: number;
    }>) {
      totalSkus += 1;
      const cost = Number(v.costPrice ?? 0);
      if (cost > 0) continue;
      missing.push({
        productId: String(p._id),
        productName: p.name,
        sku: v.sku,
        size: v.size,
        color: v.color,
        stock: Number(v.stock ?? 0),
        soldCount: Number(v.soldCount ?? 0),
      });
    }
  }

  missing.sort((a, b) => b.soldCount - a.soldCount || b.stock - a.stock);

  return {
    skus: missing.slice(0, limit),
    totalMissing: missing.length,
    totalSkus,
  };
}

export async function getReorderSuggestions(params: {
  lookbackDays?: number;
  leadTimeDays?: number;
  limit?: number;
}): Promise<ReorderSuggestion[]> {
  const lookbackDays = params.lookbackDays ?? 30;
  const leadTimeDays = params.leadTimeDays ?? 14;
  const limit = params.limit ?? 25;

  const start = new Date();
  start.setDate(start.getDate() - lookbackDays);

  const salesBySku = await Order.aggregate([
    { $match: { paymentStatus: "paid", createdAt: { $gte: start } } },
    { $unwind: "$items" },
    {
      $group: {
        _id: {
          productId: "$items.product",
          sku: "$items.variant.sku",
        },
        unitsSold: { $sum: "$items.quantity" },
      },
    },
  ]).option({ maxTimeMS: INVENTORY_QUERY_MAX_MS });

  const salesMap = new Map<string, number>();
  for (const r of salesBySku) {
    const k = `${String(r._id?.productId)}:${String(r._id?.sku)}`;
    salesMap.set(k, r.unitsSold ?? 0);
  }

  const products = await Product.find(catalogInventoryProductMatch())
    .select("name variants")
    .lean()
    .maxTimeMS(INVENTORY_QUERY_MAX_MS);

  const suggestions: ReorderSuggestion[] = [];

  for (const p of products) {
    for (const v of (p.variants ?? []) as Array<{
      sku: string;
      size?: string;
      color?: string;
      stock?: number;
      costPrice?: number;
      soldCount?: number;
    }>) {
      const stock = Number(v.stock ?? 0);
      const key = `${String(p._id)}:${v.sku}`;
      const unitsSoldInPeriod = salesMap.get(key) ?? 0;
      const avgDailySales = unitsSoldInPeriod / lookbackDays;
      const targetStock = Math.ceil(avgDailySales * leadTimeDays);
      const suggestedReorderQty = Math.max(0, targetStock - stock);

      const isLow =
        stock === 0 ||
        (stock > 0 && stock < LOW_STOCK_ALERT_EXCLUSIVE_MAX);
      const hasVelocity = unitsSoldInPeriod >= 1;

      if (!isLow && suggestedReorderQty <= 0) continue;
      if (!hasVelocity && stock === 0 && (v.soldCount ?? 0) < 1) continue;

      const priorityScore =
        (unitsSoldInPeriod / Math.max(stock, 1)) *
        (stock === 0 ? 2 : stock < LOW_STOCK_ALERT_EXCLUSIVE_MAX ? 1.5 : 1);

      suggestions.push({
        productId: String(p._id),
        productName: p.name,
        sku: v.sku,
        size: v.size,
        color: v.color,
        currentStock: stock,
        unitsSoldInPeriod,
        avgDailySales: Math.round(avgDailySales * 100) / 100,
        suggestedReorderQty,
        priorityScore: Math.round(priorityScore * 100) / 100,
        missingCost: !(Number(v.costPrice ?? 0) > 0),
      });
    }
  }

  return suggestions
    .sort((a, b) => b.priorityScore - a.priorityScore)
    .slice(0, limit);
}

/** Backfill lineCategory on legacy offline manual order lines. */
export async function backfillOfflineLineCategories(): Promise<{ updated: number }> {
  const orders = await Order.find({
    "items.slug": OFFLINE_MANUAL_ITEM_SLUG,
  }).select("items");

  let updated = 0;
  for (const order of orders) {
    let changed = false;
    for (const item of order.items) {
      if (
        item.slug === OFFLINE_MANUAL_ITEM_SLUG &&
        !item.lineCategory &&
        item.name
      ) {
        item.lineCategory = item.name;
        item.isOfflineManual = true;
        changed = true;
      }
    }
    if (changed) {
      await order.save();
      updated += 1;
    }
  }
  return { updated };
}

/** Fix legacy manual offline lines that stored the random Unsplash placeholder image. */
export async function backfillOfflineManualLineImages(): Promise<{ updated: number }> {
  const orders = await Order.find({
    "items.slug": OFFLINE_MANUAL_ITEM_SLUG,
  }).select("items");

  const categoryIds = new Set<string>();
  for (const order of orders) {
    for (const item of order.items) {
      if (item.slug === OFFLINE_MANUAL_ITEM_SLUG && item.lineCategoryId) {
        categoryIds.add(String(item.lineCategoryId));
      }
    }
  }

  const categoryImageById = new Map<string, string>();
  if (categoryIds.size > 0) {
    const cats = await Category.find({ _id: { $in: [...categoryIds] } })
      .select("image")
      .lean();
    for (const c of cats) {
      const img =
        typeof c.image === "string" && c.image.trim() ? c.image.trim() : "";
      categoryImageById.set(String(c._id), img);
    }
  }

  let updated = 0;
  for (const order of orders) {
    let changed = false;
    for (const item of order.items) {
      if (item.slug !== OFFLINE_MANUAL_ITEM_SLUG) continue;

      const categoryImg =
        item.lineCategoryId ?
          categoryImageById.get(String(item.lineCategoryId)) ?? ""
        : "";

      const nextImage = resolveOfflineManualLineImage(categoryImg);

      const needsImageFix =
        !item.image ||
        item.image.trim() === "" ||
        isLegacyOfflineManualPlaceholderImage(item.image) ||
        item.image.includes("photo-1586790170083");

      if (needsImageFix && item.image !== nextImage) {
        item.image = nextImage;
        changed = true;
      }
      if (!item.isOfflineManual) {
        item.isOfflineManual = true;
        changed = true;
      }
    }
    if (changed) {
      await order.save();
      updated += 1;
    }
  }

  return { updated };
}

/** Backfill variant soldCount from paid order history (safe to re-run). */
export async function backfillVariantSoldCounts(): Promise<{ updated: number }> {
  const rows = await Order.aggregate([
    { $match: { paymentStatus: "paid" } },
    { $unwind: "$items" },
    {
      $group: {
        _id: {
          productId: "$items.product",
          sku: "$items.variant.sku",
        },
        units: { $sum: "$items.quantity" },
      },
    },
  ]).option({ maxTimeMS: 120_000 });

  const byProduct = new Map<string, Map<string, number>>();
  for (const r of rows) {
    const pid = String(r._id?.productId ?? "");
    const sku = String(r._id?.sku ?? "");
    if (!pid || !sku) continue;
    if (sku === OFFLINE_MANUAL_VARIANT_SKU) continue;
    if (!byProduct.has(pid)) byProduct.set(pid, new Map());
    byProduct.get(pid)!.set(sku, r.units ?? 0);
  }

  let updated = 0;
  for (const [productId, skuMap] of byProduct) {
    const product = await Product.findById(productId);
    if (!product) continue;

    let productTotal = 0;
    let changed = false;

    for (const variant of product.variants) {
      const units = skuMap.get(variant.sku) ?? 0;
      if ((variant.soldCount ?? 0) !== units) {
        variant.soldCount = units;
        changed = true;
      }
      productTotal += units;
    }

    if ((product.soldCount ?? 0) !== productTotal) {
      product.soldCount = productTotal;
      changed = true;
    }

    if (changed) {
      await product.save();
      updated += 1;
    }
  }

  return { updated };
}

function isManualOfflineOrderItem(item: {
  slug?: string;
  isOfflineManual?: boolean;
  variant?: { sku?: string };
}): boolean {
  return (
    item.isOfflineManual === true ||
    item.slug === OFFLINE_MANUAL_ITEM_SLUG ||
    item.variant?.sku === OFFLINE_MANUAL_VARIANT_SKU
  );
}

/** Freeze costAtSale on paid/refunded order lines from variant cost (catalog) or 0 (manual). Safe to re-run. */
export async function backfillOrderCostAtSale(): Promise<{
  updatedOrders: number;
  updatedLines: number;
}> {
  const orders = await Order.find({
    paymentStatus: { $in: ["paid", "refunded"] },
  }).select("items");

  let updatedOrders = 0;
  let updatedLines = 0;

  for (const order of orders) {
    let changed = false;
    const productIds = [
      ...new Set(
        order.items
          .filter((it) => !isManualOfflineOrderItem(it) && it.product)
          .map((it) => String(it.product)),
      ),
    ];

    const products =
      productIds.length > 0 ?
        await Product.find({ _id: { $in: productIds } })
          .select("variants.sku variants.costPrice")
          .lean()
      : [];
    const productMap = new Map(products.map((p) => [String(p._id), p]));

    for (const item of order.items) {
      if (item.costAtSale !== undefined && item.costAtSale !== null) continue;

      if (isManualOfflineOrderItem(item)) {
        item.costAtSale = 0;
      } else {
        const prod = productMap.get(String(item.product));
        const sku = item.variant?.sku ?? "";
        const variant = prod?.variants?.find((v) => v.sku === sku);
        item.costAtSale = Math.max(0, Number(variant?.costPrice ?? 0));
      }

      changed = true;
      updatedLines += 1;
    }

    if (changed) {
      await order.save();
      updatedOrders += 1;
    }
  }

  return { updatedOrders, updatedLines };
}
