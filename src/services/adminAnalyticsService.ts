import Order from "../models/Order";
import User from "../models/User";
import Product from "../models/Product";
import Review from "../models/Review";
import { LOW_STOCK_ALERT_EXCLUSIVE_MAX } from "../constants/inventory";
import { getInventorySummaryStats } from "./inventory/inventoryCacheService";
import {
  couponDiscountPipeline,
  orderFeesPipeline,
  taxCollectedPipeline,
} from "./orderFinanceAggregations";
import { getStoreVisitStats } from "./storeVisitService";

const stockListProjection = {
  $project: { _id: 1, name: 1, category: 1, totalStock: "$computedTotal" },
};

function activeProductStockPipeline(matchStock: Record<string, unknown>) {
  return [
    { $match: { isActive: true } },
    { $addFields: { computedTotal: { $sum: "$variants.stock" } } },
    { $match: matchStock },
    { $sort: { computedTotal: 1 as const, name: 1 as const } },
    { $limit: 8 },
    stockListProjection,
  ];
}

/** Paid + refunded: both represent checkout totals we recognised; refunds are subtracted separately. */
const PAYMENT_STATUS_GROSS = { paymentStatus: { $in: ["paid", "refunded"] as const } };

/**
 * Unwind paid order lines and attach variant cost from catalog (SKU match).
 * COGS uses current variant costPrice — best available proxy when orders omit unit cost.
 */
function paidOrderLineProfitStages(extraMatch: Record<string, unknown> = {}) {
  return [
    { $match: { paymentStatus: "paid" as const, ...extraMatch } },
    { $unwind: "$items" },
    {
      $lookup: {
        from: "products",
        localField: "items.product",
        foreignField: "_id",
        as: "productDoc",
      },
    },
    { $unwind: { path: "$productDoc", preserveNullAndEmptyArrays: true } },
    {
      $addFields: {
        matchedVariant: {
          $arrayElemAt: [
            {
              $filter: {
                input: { $ifNull: ["$productDoc.variants", []] },
                as: "v",
                cond: { $eq: ["$$v.sku", "$items.variant.sku"] },
              },
            },
            0,
          ],
        },
      },
    },
    {
      $addFields: {
        unitCost: { $ifNull: ["$matchedVariant.costPrice", 0] },
        lineRevenue: { $multiply: ["$items.price", "$items.quantity"] },
      },
    },
    {
      $addFields: {
        lineCogs: { $multiply: ["$unitCost", "$items.quantity"] },
        hasCostData: { $gt: ["$unitCost", 0] },
        lineProfit: {
          $subtract: [
            { $multiply: ["$items.price", "$items.quantity"] },
            { $multiply: ["$unitCost", "$items.quantity"] },
          ],
        },
      },
    },
  ];
}

/**
 * All "today / this month" boundaries are computed in **Asia/Kolkata** so
 * the dashboard reads the same regardless of where the API host is running.
 */
const IST_TZ = "Asia/Kolkata";
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

function istParts(date: Date): { year: number; month: number; day: number } {
  const shifted = new Date(date.getTime() + IST_OFFSET_MS);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth(),
    day: shifted.getUTCDate(),
  };
}

function istMidnight(year: number, monthIdx: number, day: number): Date {
  return new Date(Date.UTC(year, monthIdx, day) - IST_OFFSET_MS);
}

export async function getDashboardAnalyticsData() {
  const now = new Date();
  const ist = istParts(now);
  const startOfToday = istMidnight(ist.year, ist.month, ist.day);
  const startOfMonth = istMidnight(ist.year, ist.month, 1);
  const startOfThisMonthIst = startOfMonth;
  const startOfLastMonth = istMidnight(ist.year, ist.month - 1, 1);
  const endOfLastMonth = new Date(startOfThisMonthIst.getTime() - 1);
  const startOfDailyWindow = istMidnight(ist.year, ist.month, ist.day - 32);
  const startOfYearWindow = istMidnight(ist.year, ist.month - 11, 1);

  const [
    totalRevenue,
    monthRevenue,
    lastMonthRevenue,
    totalOrders,
    monthOrders,
    totalUsers,
    newUsersThisMonth,
    totalProducts,
    outOfStockProducts,
    lowStockOnlyProducts,
    recentOrders,
    ordersByStatus,
    revenueByMonth,
    topProducts,
    avgOrderValue,
    ordersToday,
    pendingFulfillmentCount,
    paidOrdersCount,
    totalReviews,
    reviewsThisMonth,
    topViewedRaw,
    revenueByCategory,
    totalRefunds,
    refundsByReason,
    nonRefundableFeesRetained,
    revenueTodayAgg,
    revenueByDaySparse,
    // ── New entrepreneur-level aggregations ──────────────────────────────────
    couponDiscountTotal,
    couponDiscountMTD,
    paymentMethodMix,
    onlineVsOfflineMix,
    orderFeesAgg,
    taxCollected,
    cancellationCount,
    ordersByHour,
    topVariantSizes,
    repeatCustomersAgg,
    profitSummaryLifetime,
    profitSummaryMtd,
    topProductsByProfit,
    categoryProfit,
    profitByMonth,
    refundsByMonth,
    inventorySummaryStats,
    storefrontViewStats,
    ordersByCampaignRaw,
  ] = await Promise.all([
    // ── Existing ────────────────────────────────────────────────────────────
    Order.aggregate([{ $match: PAYMENT_STATUS_GROSS }, { $group: { _id: null, total: { $sum: "$total" } } }]),
    Order.aggregate([
      { $match: { ...PAYMENT_STATUS_GROSS, createdAt: { $gte: startOfMonth } } },
      { $group: { _id: null, total: { $sum: "$total" } } },
    ]),
    Order.aggregate([
      { $match: { ...PAYMENT_STATUS_GROSS, createdAt: { $gte: startOfLastMonth, $lte: endOfLastMonth } } },
      { $group: { _id: null, total: { $sum: "$total" } } },
    ]),
    Order.countDocuments(),
    Order.countDocuments({ createdAt: { $gte: startOfMonth } }),
    User.countDocuments({ role: "user" }),
    User.countDocuments({ role: "user", createdAt: { $gte: startOfMonth } }),
    Product.countDocuments({ isActive: true }),
    Product.aggregate(activeProductStockPipeline({ computedTotal: 0 })),
    Product.aggregate(
      activeProductStockPipeline({
        computedTotal: { $gt: 0, $lt: LOW_STOCK_ALERT_EXCLUSIVE_MAX },
      }),
    ),
    Order.find().sort("-createdAt").limit(10).populate("user", "name email"),
    Order.aggregate([{ $group: { _id: "$status", count: { $sum: 1 } } }]),
    Order.aggregate([
      { $match: { ...PAYMENT_STATUS_GROSS, createdAt: { $gte: startOfYearWindow } } },
      {
        $group: {
          _id: {
            year: { $year: { date: "$createdAt", timezone: IST_TZ } },
            month: { $month: { date: "$createdAt", timezone: IST_TZ } },
          },
          revenue: { $sum: "$total" },
          orders: { $sum: 1 },
        },
      },
      { $sort: { "_id.year": 1, "_id.month": 1 } },
    ]),
    Order.aggregate([
      { $match: { paymentStatus: "paid" } },
      { $unwind: "$items" },
      { $group: { _id: "$items.product", totalSold: { $sum: "$items.quantity" }, revenue: { $sum: { $multiply: ["$items.price", "$items.quantity"] } }, name: { $first: "$items.name" }, image: { $first: "$items.image" } } },
      { $sort: { totalSold: -1 } },
      { $limit: 5 },
    ]),
    Order.aggregate([{ $match: PAYMENT_STATUS_GROSS }, { $group: { _id: null, avg: { $avg: "$total" } } }]),
    Order.countDocuments({ createdAt: { $gte: startOfToday } }),
    Order.countDocuments({ status: { $in: ["pending", "confirmed", "processing"] } }),
    Order.countDocuments({ paymentStatus: "paid" }),
    Review.countDocuments(),
    Review.countDocuments({ createdAt: { $gte: startOfMonth } }),
    Product.find({ isActive: true, viewCount: { $gt: 0 } })
      .sort({ viewCount: -1 })
      .limit(100)
      .select("name slug images category viewCount price ratings")
      .lean(),
    Order.aggregate([
      { $match: { paymentStatus: "paid" } },
      { $unwind: "$items" },
      { $lookup: { from: "products", localField: "items.product", foreignField: "_id", as: "p" } },
      { $unwind: { path: "$p", preserveNullAndEmptyArrays: true } },
      { $group: { _id: "$p.category", revenue: { $sum: { $multiply: ["$items.price", "$items.quantity"] } }, units: { $sum: "$items.quantity" } } },
      { $match: { _id: { $nin: [null, ""] } } },
      { $sort: { revenue: -1 } },
      { $limit: 10 },
    ]),
    Order.aggregate([
      { $match: { "refundData.amount": { $exists: true } } },
      { $group: { _id: null, total: { $sum: "$refundData.amount" }, count: { $sum: 1 } } },
    ]),
    Order.aggregate([
      { $match: { returnStatus: { $in: ["requested", "approved", "returned"] }, "returnRequest.reason": { $exists: true } } },
      { $group: { _id: "$returnRequest.reason", count: { $sum: 1 } } },
    ]),
    Order.aggregate([
      { $match: { "refundData.nonRefundableFees": { $gt: 0 } } },
      { $group: { _id: null, total: { $sum: "$refundData.nonRefundableFees" } } },
    ]),
    Order.aggregate([
      { $match: { ...PAYMENT_STATUS_GROSS, createdAt: { $gte: startOfToday } } },
      { $group: { _id: null, total: { $sum: "$total" } } },
    ]),
    Order.aggregate([
      { $match: { ...PAYMENT_STATUS_GROSS, createdAt: { $gte: startOfDailyWindow } } },
      {
        $group: {
          _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt", timezone: IST_TZ } },
          revenue: { $sum: "$total" },
          orders: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
    ]),

    // ── NEW: Coupon discount totals (stored discount or implied when coupon ref exists) ──
    Order.aggregate(couponDiscountPipeline()),
    Order.aggregate(couponDiscountPipeline({ createdAt: { $gte: startOfMonth } })),

    // ── NEW: Payment method revenue mix ────────────────────────────────────
    Order.aggregate([
      { $match: PAYMENT_STATUS_GROSS },
      {
        $group: {
          _id: "$paymentMethod",
          revenue: { $sum: "$total" },
          count: { $sum: 1 },
        },
      },
      { $sort: { revenue: -1 } },
    ]),

    // ── NEW: Online vs Offline revenue split ────────────────────────────────
    Order.aggregate([
      { $match: PAYMENT_STATUS_GROSS },
      {
        $group: {
          _id: {
            $cond: [{ $ifNull: ["$offlineMeta", false] }, "offline", "online"],
          },
          revenue: { $sum: "$total" },
          count: { $sum: 1 },
        },
      },
    ]),

    // ── NEW: Shipping / COD / GST ───────────────────────────────────────────
    Order.aggregate(orderFeesPipeline()),
    Order.aggregate(taxCollectedPipeline()),

    // ── NEW: Cancellation count ─────────────────────────────────────────────
    Order.countDocuments({ status: "cancelled" }),

    // ── NEW: Hour-of-day order distribution (IST) ──────────────────────────
    Order.aggregate([
      { $match: PAYMENT_STATUS_GROSS },
      {
        $group: {
          _id: { $hour: { date: "$createdAt", timezone: IST_TZ } },
          orders: { $sum: 1 },
          revenue: { $sum: "$total" },
        },
      },
      { $sort: { _id: 1 } },
    ]),

    // ── NEW: Top variant sizes / labels sold ────────────────────────────────
    Order.aggregate([
      { $match: { paymentStatus: "paid" } },
      { $unwind: "$items" },
      { $match: { "items.variant.size": { $exists: true, $nin: [null, ""] } } },
      {
        $group: {
          _id: "$items.variant.size",
          units: { $sum: "$items.quantity" },
          revenue: { $sum: { $multiply: ["$items.price", "$items.quantity"] } },
        },
      },
      { $sort: { units: -1 } },
      { $limit: 10 },
    ]),

    // ── NEW: Repeat customers (users with >1 paid order) ────────────────────
    Order.aggregate([
      { $match: { paymentStatus: "paid", user: { $exists: true, $ne: null } } },
      { $group: { _id: "$user", orderCount: { $sum: 1 }, totalSpent: { $sum: "$total" } } },
      {
        $group: {
          _id: null,
          totalCustomers: { $sum: 1 },
          repeatCustomers: { $sum: { $cond: [{ $gt: ["$orderCount", 1] }, 1, 0] } },
          totalLtv: { $sum: "$totalSpent" },
        },
      },
    ]),
    Order.aggregate([
      ...paidOrderLineProfitStages(),
      {
        $group: {
          _id: null,
          productRevenue: { $sum: "$lineRevenue" },
          productCogs: { $sum: "$lineCogs" },
          grossProfit: { $sum: "$lineProfit" },
          unitsSold: { $sum: "$items.quantity" },
          orderLines: { $sum: 1 },
          linesMissingCost: { $sum: { $cond: ["$hasCostData", 0, 1] } },
        },
      },
    ]),
    Order.aggregate([
      ...paidOrderLineProfitStages({ createdAt: { $gte: startOfMonth } }),
      {
        $group: {
          _id: null,
          productRevenue: { $sum: "$lineRevenue" },
          productCogs: { $sum: "$lineCogs" },
          grossProfit: { $sum: "$lineProfit" },
          unitsSold: { $sum: "$items.quantity" },
        },
      },
    ]),
    Order.aggregate([
      ...paidOrderLineProfitStages(),
      {
        $group: {
          _id: "$items.product",
          name: { $first: "$items.name" },
          image: { $first: "$items.image" },
          category: { $first: { $ifNull: ["$productDoc.category", "Uncategorized"] } },
          unitsSold: { $sum: "$items.quantity" },
          revenue: { $sum: "$lineRevenue" },
          cogs: { $sum: "$lineCogs" },
          profit: { $sum: "$lineProfit" },
          linesMissingCost: { $sum: { $cond: ["$hasCostData", 0, 1] } },
          orderLines: { $sum: 1 },
        },
      },
      {
        $addFields: {
          marginPercent: {
            $cond: [
              { $gt: ["$revenue", 0] },
              { $round: [{ $multiply: [{ $divide: ["$profit", "$revenue"] }, 100] }, 1] },
              0,
            ],
          },
          avgSellPrice: {
            $cond: [
              { $gt: ["$unitsSold", 0] },
              { $round: [{ $divide: ["$revenue", "$unitsSold"] }, 2] },
              0,
            ],
          },
          avgUnitCost: {
            $cond: [
              { $gt: ["$unitsSold", 0] },
              { $round: [{ $divide: ["$cogs", "$unitsSold"] }, 2] },
              0,
            ],
          },
        },
      },
      { $sort: { profit: -1 } },
      { $limit: 20 },
    ]),
    Order.aggregate([
      ...paidOrderLineProfitStages(),
      {
        $group: {
          _id: { $ifNull: ["$productDoc.category", "Uncategorized"] },
          revenue: { $sum: "$lineRevenue" },
          cogs: { $sum: "$lineCogs" },
          profit: { $sum: "$lineProfit" },
          units: { $sum: "$items.quantity" },
        },
      },
      {
        $addFields: {
          marginPercent: {
            $cond: [
              { $gt: ["$revenue", 0] },
              { $round: [{ $multiply: [{ $divide: ["$profit", "$revenue"] }, 100] }, 1] },
              0,
            ],
          },
        },
      },
      { $sort: { profit: -1 } },
      { $limit: 12 },
    ]),
    Order.aggregate([
      ...paidOrderLineProfitStages({ createdAt: { $gte: startOfYearWindow } }),
      {
        $group: {
          _id: {
            year: { $year: { date: "$createdAt", timezone: IST_TZ } },
            month: { $month: { date: "$createdAt", timezone: IST_TZ } },
          },
          productRevenue: { $sum: "$lineRevenue" },
          cogs: { $sum: "$lineCogs" },
          grossProfit: { $sum: "$lineProfit" },
        },
      },
      { $sort: { "_id.year": 1 as const, "_id.month": 1 as const } },
    ]),
    Order.aggregate([
      { $match: { "refundData.amount": { $gt: 0 } } },
      {
        $addFields: {
          refundAt: { $ifNull: ["$refundData.processedAt", "$updatedAt"] },
        },
      },
      { $match: { refundAt: { $gte: startOfYearWindow } } },
      {
        $group: {
          _id: {
            year: { $year: { date: "$refundAt", timezone: IST_TZ } },
            month: { $month: { date: "$refundAt", timezone: IST_TZ } },
          },
          refunds: { $sum: "$refundData.amount" },
          count: { $sum: 1 },
        },
      },
      { $sort: { "_id.year": 1 as const, "_id.month": 1 as const } },
    ]),
    getInventorySummaryStats(),
    Product.aggregate([
      { $match: { isActive: true } },
      {
        $group: {
          _id: null,
          totalPdpViews: { $sum: { $ifNull: ["$viewCount", 0] } },
          productsWithViews: { $sum: { $cond: [{ $gt: [{ $ifNull: ["$viewCount", 0] }, 0] }, 1, 0] } },
        },
      },
    ]),
    Order.aggregate([
      {
        $match: {
          paymentStatus: "paid",
          "marketingAttribution.utmCampaign": { $exists: true, $nin: [null, ""] },
          createdAt: { $gte: startOfDailyWindow },
        },
      },
      {
        $group: {
          _id: "$marketingAttribution.utmCampaign",
          orders: { $sum: 1 },
          revenue: { $sum: "$total" },
        },
      },
      { $sort: { revenue: -1 as const } },
      { $limit: 10 },
    ]),
  ]);

  const visitStats = await getStoreVisitStats();

  const invSummary = inventorySummaryStats as {
    totalProducts?: number;
    totalUnits?: number;
    outOfStock?: number;
    lowStock?: number;
  };
  const stockHealth = {
    outOfStock: Number(invSummary.outOfStock ?? 0),
    lowStock: Number(invSummary.lowStock ?? 0),
    totalActiveProducts: Number(invSummary.totalProducts ?? totalProducts),
    totalUnits: Number(invSummary.totalUnits ?? 0),
  };
  const lowStockProducts = [
    ...(outOfStockProducts as { _id: string; name: string; totalStock: number; category: string }[]),
    ...(lowStockOnlyProducts as { _id: string; name: string; totalStock: number; category: string }[]),
  ].sort((a, b) => a.totalStock - b.totalStock);

  // ── Post-processing: topViewedProducts ────────────────────────────────────
  type LeanProduct = {
    _id: unknown;
    name: string;
    slug: string;
    images?: { url: string }[];
    category: string;
    viewCount?: number;
    price: number;
    ratings?: { average: number };
  };

  let topViewedProducts: {
    _id: unknown;
    name: string;
    slug: string;
    image: string;
    category: string;
    views: number;
    price: number;
    ratingAvg: number;
    sold: number;
    conversionPercent: number;
  }[] = [];

  const viewed = topViewedRaw as LeanProduct[];
  if (viewed.length > 0) {
    const viewIds = viewed.map((p) => p._id);
    const soldRows = await Order.aggregate([
      { $match: { paymentStatus: "paid" } },
      { $unwind: "$items" },
      { $match: { "items.product": { $in: viewIds } } },
      { $group: { _id: "$items.product", sold: { $sum: "$items.quantity" } } },
    ]);
    const soldMap = new Map(soldRows.map((r) => [String(r._id), r.sold as number]));
    topViewedProducts = viewed.map((p) => {
      const views = p.viewCount ?? 0;
      const sold = soldMap.get(String(p._id)) || 0;
      const conversionPercent = views > 0 ? Math.round((sold / views) * 10000) / 100 : 0;
      return {
        _id: p._id,
        name: p.name,
        slug: p.slug,
        image: p.images?.[0]?.url || "",
        category: p.category,
        views,
        price: p.price,
        ratingAvg: p.ratings?.average ?? 0,
        sold,
        conversionPercent,
      };
    });
  }

  // ── Post-processing: revenueByDay dense fill ──────────────────────────────
  const sparseDaily = (revenueByDaySparse || []) as { _id: string; revenue: number; orders: number }[];
  const dailyMap = new Map(sparseDaily.map((r) => [r._id, r]));
  const fmtIso = new Intl.DateTimeFormat("sv-SE", {
    timeZone: IST_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const istTodayStr = fmtIso.format(now);
  const anchor = new Date(`${istTodayStr}T12:00:00+05:30`);
  const revenueByDay: { date: string; revenue: number; orders: number }[] = [];
  // Oldest → newest (today last) for charts and AI "yesterday" = index length - 2
  for (let i = 0; i < 30; i++) {
    const d = new Date(anchor.getTime() - (29 - i) * 86400000);
    const date = fmtIso.format(d);
    const row = dailyMap.get(date);
    revenueByDay.push({ date, revenue: row?.revenue ?? 0, orders: row?.orders ?? 0 });
  }

  // ── Post-processing: hour heatmap (fill 0-23) ─────────────────────────────
  const hourMap = new Map<number, { orders: number; revenue: number }>(
    (ordersByHour as { _id: number; orders: number; revenue: number }[]).map((r) => [r._id, r])
  );
  const ordersByHourFull = Array.from({ length: 24 }, (_, h) => ({
    hour: h,
    orders: hourMap.get(h)?.orders ?? 0,
    revenue: hourMap.get(h)?.revenue ?? 0,
  }));

  // ── Post-processing: repeat customer metrics ──────────────────────────────
  const rcAgg = (repeatCustomersAgg as { _id: null; totalCustomers: number; repeatCustomers: number; totalLtv: number }[])[0];
  const totalCustomers = rcAgg?.totalCustomers ?? 0;
  const repeatCustomers = rcAgg?.repeatCustomers ?? 0;
  const totalLtv = rcAgg?.totalLtv ?? 0;
  const avgLtv = totalCustomers > 0 ? Math.round((totalLtv / totalCustomers) * 100) / 100 : 0;
  const repeatRate = totalCustomers > 0 ? Math.round((repeatCustomers / totalCustomers) * 1000) / 10 : 0;

  // ── Post-processing: online vs offline ────────────────────────────────────
  type ChannelRow = { _id: "online" | "offline"; revenue: number; count: number };
  const channelMap = new Map<string, ChannelRow>(
    (onlineVsOfflineMix as ChannelRow[]).map((r) => [r._id, r])
  );
  const onlineRevenue = channelMap.get("online")?.revenue ?? 0;
  const offlineRevenue = channelMap.get("offline")?.revenue ?? 0;
  const onlineCount = channelMap.get("online")?.count ?? 0;
  const offlineCount = channelMap.get("offline")?.count ?? 0;

  // ── Revenue growth (null = no last-month baseline to compare) ─────────────
  const currentMonthRevenue = monthRevenue[0]?.total || 0;
  const prevMonthRevenue = lastMonthRevenue[0]?.total || 0;
  const revenueGrowth =
    prevMonthRevenue > 0 ?
      Math.round(((currentMonthRevenue - prevMonthRevenue) / prevMonthRevenue) * 1000) / 10
    : currentMonthRevenue > 0 ?
      null
    : 0;

  const viewStats = (storefrontViewStats as { totalPdpViews?: number; productsWithViews?: number }[])[0];
  const totalPdpViews = viewStats?.totalPdpViews ?? 0;
  const productsWithViews = viewStats?.productsWithViews ?? 0;
  const firstTimeBuyers = Math.max(0, totalCustomers - repeatCustomers);

  type ProfitRow = {
    productRevenue?: number;
    productCogs?: number;
    grossProfit?: number;
    unitsSold?: number;
    orderLines?: number;
    linesMissingCost?: number;
  };
  const plLifetime = (profitSummaryLifetime as ProfitRow[])[0];
  const plMtd = (profitSummaryMtd as ProfitRow[])[0];
  const lifetimeProductRevenue = plLifetime?.productRevenue ?? 0;
  const lifetimeProductCogs = plLifetime?.productCogs ?? 0;
  const lifetimeGrossProfit = plLifetime?.grossProfit ?? 0;
  const lifetimeGrossMarginPct =
    lifetimeProductRevenue > 0 ?
      Math.round((lifetimeGrossProfit / lifetimeProductRevenue) * 1000) / 10
    : 0;
  const mtdProductRevenue = plMtd?.productRevenue ?? 0;
  const mtdProductCogs = plMtd?.productCogs ?? 0;
  const mtdGrossProfit = plMtd?.grossProfit ?? 0;
  const mtdGrossMarginPct =
    mtdProductRevenue > 0 ? Math.round((mtdGrossProfit / mtdProductRevenue) * 1000) / 10 : 0;
  const profitLinesMissingCost = plLifetime?.linesMissingCost ?? 0;
  const profitOrderLines = plLifetime?.orderLines ?? 0;

  const ordersByCampaign = (
    ordersByCampaignRaw as { _id: string; orders: number; revenue: number }[]
  ).map((r) => ({
    campaign: r._id,
    orders: r.orders,
    revenue: Math.round(r.revenue * 100) / 100,
  }));

  return {
    overview: {
      totalRevenue: totalRevenue[0]?.total || 0,
      monthRevenue: currentMonthRevenue,
      revenueGrowth,
      totalPdpViews,
      productsWithViews,
      firstTimeBuyers,
      totalSiteVisits: visitStats.totalSiteVisits,
      siteVisitsToday: visitStats.siteVisitsToday,
      siteVisitsMtd: visitStats.siteVisitsMtd,
      totalOrders,
      monthOrders,
      totalUsers,
      newUsersThisMonth,
      totalProducts,
      avgOrderValue: Math.round((avgOrderValue[0]?.avg || 0) * 100) / 100,
      ordersToday,
      revenueToday: Math.round((revenueTodayAgg[0]?.total || 0) * 100) / 100,
      pendingFulfillmentCount,
      paidOrdersCount,
      totalReviews,
      reviewsThisMonth,
      refundedAmount: totalRefunds[0]?.total || 0,
      refundedOrdersCount: totalRefunds[0]?.count || 0,
      nonRefundableFeesRetained: nonRefundableFeesRetained[0]?.total || 0,
      // ── New fields ───────────────────────────────────────────────────────
      cancellationCount,
      cancellationRate: totalOrders > 0 ? Math.round((cancellationCount / totalOrders) * 1000) / 10 : 0,
      couponDiscountTotal: couponDiscountTotal[0]?.totalDiscount || 0,
      couponDiscountMTD: couponDiscountMTD[0]?.totalDiscount || 0,
      couponOrdersTotal: couponDiscountTotal[0]?.count || 0,
      shippingCollected: orderFeesAgg[0]?.shipping || 0,
      codFeeCollected: orderFeesAgg[0]?.cod || 0,
      taxCollected: taxCollected[0]?.total || 0,
      onlineRevenue,
      offlineRevenue,
      onlineCount,
      offlineCount,
      repeatCustomers,
      totalCustomersWithOrders: totalCustomers,
      repeatRate,
      avgLtv,
      // Product-level profit (paid lines · catalog cost)
      productRevenue: Math.round(lifetimeProductRevenue * 100) / 100,
      productCogs: Math.round(lifetimeProductCogs * 100) / 100,
      grossProfit: Math.round(lifetimeGrossProfit * 100) / 100,
      grossMarginPercent: lifetimeGrossMarginPct,
      monthProductRevenue: Math.round(mtdProductRevenue * 100) / 100,
      monthProductCogs: Math.round(mtdProductCogs * 100) / 100,
      monthGrossProfit: Math.round(mtdGrossProfit * 100) / 100,
      monthGrossMarginPercent: mtdGrossMarginPct,
      profitLinesMissingCost,
      profitOrderLines,
    },
    refundsByReason,
    stockHealth,
    outOfStockProducts,
    lowStockOnlyProducts,
    lowStockProducts,
    recentOrders,
    ordersByStatus,
    revenueByMonth,
    topProducts,
    topViewedProducts,
    revenueByCategory,
    revenueByDay,
    visitsByDay: visitStats.visitsByDay,
    visitInsights: {
      byCountry: visitStats.visitsByCountry,
      bySource: visitStats.visitsBySource,
      byDevice: visitStats.visitsByDevice,
      byLandingPage: visitStats.visitsByLandingPage,
      byCampaign: visitStats.visitsByCampaign,
      recent: visitStats.recentVisits,
    },
    marketingInsights: {
      ordersByCampaign,
    },
    paymentMethodMix: (paymentMethodMix as { _id: string; revenue: number; count: number }[]),
    ordersByHour: ordersByHourFull,
    topVariantSizes: (topVariantSizes as { _id: string; units: number; revenue: number }[]),
    topProductsByProfit: topProductsByProfit as {
      _id: string;
      name: string;
      image: string;
      category: string;
      unitsSold: number;
      revenue: number;
      cogs: number;
      profit: number;
      marginPercent: number;
      avgSellPrice: number;
      avgUnitCost: number;
      linesMissingCost: number;
      orderLines: number;
    }[],
    categoryProfit: categoryProfit as {
      _id: string;
      revenue: number;
      cogs: number;
      profit: number;
      units: number;
      marginPercent: number;
    }[],
    profitByMonth: profitByMonth as {
      _id: { year: number; month: number };
      productRevenue: number;
      cogs: number;
      grossProfit: number;
    }[],
    refundsByMonth: refundsByMonth as {
      _id: { year: number; month: number };
      refunds: number;
      count: number;
    }[],
  };
}
