import Order from "../models/Order";
import User from "../models/User";
import Product from "../models/Product";
import Review from "../models/Review";
import AnalyticsDailySnapshot from "../models/AnalyticsDailySnapshot";
import { LOW_STOCK_ALERT_EXCLUSIVE_MAX } from "../constants/inventory";
import { getInventorySummaryStats } from "./inventory/inventoryCacheService";
import {
  couponDiscountPipeline,
  promotionDiscountPipeline,
  saleDiscountPipeline,
  orderFeesPipeline,
  taxCollectedPipeline,
} from "./orderFinanceAggregations";
import { getStoreVisitStats } from "./storeVisitService";
import { getMetaTrackingStatus } from "./metaCapiService";
import { ORDER_CHANNEL_SWITCH } from "../utils/orderChannel";
import { paidOrderLineProfitStages } from "./orderProfitAggregationHelpers";
import { getOfferAttributionSummary } from "./offerAttributionService";
import { resolveRevenuePeriodBounds } from "./revenuePeriodService";

const stockListProjection = {
  $project: {
    _id: 1,
    name: 1,
    category: 1,
    totalStock: "$computedTotal",
    soldCount: { $ifNull: ["$soldCount", 0] },
  },
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

/** Prefer pre-aggregated daily snapshots (skips heavy 30d rollups on dashboard load). */
function analyticsSnapshotsEnabled(): boolean {
  const raw = (process.env.ANALYTICS_USE_SNAPSHOTS || "").toLowerCase().trim();
  if (raw === "false") return false;
  if (raw === "true") return true;
  return process.env.NODE_ENV === "production";
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

  const fmtIso = new Intl.DateTimeFormat("sv-SE", {
    timeZone: IST_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const istTodayStr = fmtIso.format(now);
  const thirtyDaysAgoStr = fmtIso.format(
    new Date(now.getTime() - 30 * 86400000),
  );
  const useSnapshots = analyticsSnapshotsEnabled();
  const snapshots = useSnapshots
    ? await AnalyticsDailySnapshot.find({
        date: { $gte: thirtyDaysAgoStr, $lt: istTodayStr },
      })
        .lean()
        .maxTimeMS(3000)
    : [];

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
    promotionDiscountTotal,
    promotionDiscountMTD,
    saleDiscountTotal,
    offerAttributionMtd,
    paymentMethodMix,
    onlineVsOfflineMix,
    orderFeesAgg,
    taxCollected,
    cancellationCount,
    ordersByHour,
    topVariantSizes,
    topVariantColors,
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
    ordersBySourceRaw,
    attributedOrdersAgg,
    fbclidOrdersAgg,
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
      {
        $addFields: {
          resolvedLineCategory: {
            $cond: [
              { $ne: [{ $ifNull: ["$items.lineCategory", ""] }, ""] },
              "$items.lineCategory",
              { $ifNull: ["$p.category", "Uncategorized"] },
            ],
          },
        },
      },
      {
        $group: {
          _id: "$resolvedLineCategory",
          revenue: { $sum: { $multiply: ["$items.price", "$items.quantity"] } },
          units: { $sum: "$items.quantity" },
        },
      },
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
    useSnapshots
      ? Promise.resolve([])
      : Order.aggregate([
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
    Order.aggregate(promotionDiscountPipeline()),
    Order.aggregate(promotionDiscountPipeline({ createdAt: { $gte: startOfMonth } })),
    Order.aggregate(saleDiscountPipeline()),
    getOfferAttributionSummary(resolveRevenuePeriodBounds("month")),

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
          _id: ORDER_CHANNEL_SWITCH,
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

    // ── NEW: Top variant colors sold ────────────────────────────────────────
    Order.aggregate([
      { $match: { paymentStatus: "paid" } },
      { $unwind: "$items" },
      {
        $addFields: {
          colorLabel: {
            $cond: [
              {
                $and: [
                  { $ne: ["$items.variant.color", null] },
                  { $ne: ["$items.variant.color", ""] },
                ],
              },
              "$items.variant.color",
              "Default",
            ],
          },
        },
      },
      {
        $group: {
          _id: "$colorLabel",
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
          _id: "$profitGroupKey",
          name: { $first: "$items.name" },
          image: { $first: "$items.image" },
          category: { $first: "$resolvedLineCategory" },
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
          _id: "$resolvedLineCategory",
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
    Order.aggregate([
      {
        $match: {
          paymentStatus: "paid",
          "marketingAttribution.utmSource": { $exists: true, $nin: [null, ""] },
          createdAt: { $gte: startOfDailyWindow },
        },
      },
      {
        $group: {
          _id: "$marketingAttribution.utmSource",
          orders: { $sum: 1 },
          revenue: { $sum: "$total" },
        },
      },
      { $sort: { revenue: -1 as const } },
      { $limit: 8 },
    ]),
    Order.countDocuments({
      paymentStatus: "paid",
      createdAt: { $gte: startOfDailyWindow },
      $or: [
        { "marketingAttribution.utmCampaign": { $exists: true, $nin: [null, ""] } },
        { "marketingAttribution.utmSource": { $exists: true, $nin: [null, ""] } },
        { "marketingAttribution.fbclid": { $exists: true, $nin: [null, ""] } },
      ],
    }),
    Order.countDocuments({
      paymentStatus: "paid",
      createdAt: { $gte: startOfDailyWindow },
      "marketingAttribution.fbclid": { $exists: true, $nin: [null, ""] },
    }),
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

  for (const snap of snapshots) {
    dailyMap.set(snap.date, {
      _id: snap.date,
      revenue: snap.revenue,
      orders: snap.orders,
    });
  }

  if (useSnapshots) {
    dailyMap.set(istTodayStr, {
      _id: istTodayStr,
      revenue: (revenueTodayAgg as { total?: number }[])[0]?.total ?? 0,
      orders: ordersToday,
    });
  }

  const snapshotByDate = new Map(snapshots.map((s) => [s.date, s]));

  const anchor = new Date(`${istTodayStr}T12:00:00+05:30`);
  const revenueByDay: { date: string; revenue: number; orders: number }[] = [];
  const visitsByDayFromSnapshots: { date: string; visits: number }[] = [];
  const dailyMetrics: {
    date: string;
    revenue: number;
    orders: number;
    paidOrders: number;
    cancelledOrders: number;
    newUsers: number;
    avgOrderValue: number;
    siteVisits: number;
    couponDiscount: number;
    refundedAmount: number;
    fromSnapshot: boolean;
  }[] = [];

  let snapshotTotals = {
    revenue: 0,
    orders: 0,
    paidOrders: 0,
    cancelledOrders: 0,
    newUsers: 0,
    siteVisits: 0,
    couponDiscount: 0,
    refundedAmount: 0,
  };

  // Oldest → newest (today last) for charts and AI "yesterday" = index length - 2
  for (let i = 0; i < 30; i++) {
    const d = new Date(anchor.getTime() - (29 - i) * 86400000);
    const date = fmtIso.format(d);
    const row = dailyMap.get(date);
    const snap = snapshotByDate.get(date);
    const isPastDay = date < istTodayStr;

    revenueByDay.push({ date, revenue: row?.revenue ?? 0, orders: row?.orders ?? 0 });

    const visitsLive =
      visitStats.visitsByDay.find((v) => v.date === date)?.visits ?? 0;
    visitsByDayFromSnapshots.push({
      date,
      visits: isPastDay && snap ? (snap.siteVisits ?? 0) : visitsLive,
    });

    if (isPastDay && snap) {
      snapshotTotals = {
        revenue: snapshotTotals.revenue + (snap.revenue ?? 0),
        orders: snapshotTotals.orders + (snap.orders ?? 0),
        paidOrders: snapshotTotals.paidOrders + (snap.paidOrders ?? 0),
        cancelledOrders: snapshotTotals.cancelledOrders + (snap.cancelledOrders ?? 0),
        newUsers: snapshotTotals.newUsers + (snap.newUsers ?? 0),
        siteVisits: snapshotTotals.siteVisits + (snap.siteVisits ?? 0),
        couponDiscount: snapshotTotals.couponDiscount + (snap.couponDiscount ?? 0),
        refundedAmount: snapshotTotals.refundedAmount + (snap.refundedAmount ?? 0),
      };
    }

    dailyMetrics.push({
      date,
      revenue: isPastDay && snap ? snap.revenue : (row?.revenue ?? 0),
      orders: isPastDay && snap ? snap.orders : (row?.orders ?? 0),
      paidOrders: isPastDay && snap ? (snap.paidOrders ?? 0) : 0,
      cancelledOrders: isPastDay && snap ? (snap.cancelledOrders ?? 0) : 0,
      newUsers: isPastDay && snap ? (snap.newUsers ?? 0) : 0,
      avgOrderValue: isPastDay && snap ? (snap.avgOrderValue ?? 0) : 0,
      siteVisits:
        isPastDay && snap ? (snap.siteVisits ?? 0) : visitsLive,
      couponDiscount: isPastDay && snap ? (snap.couponDiscount ?? 0) : 0,
      refundedAmount: isPastDay && snap ? (snap.refundedAmount ?? 0) : 0,
      fromSnapshot: Boolean(isPastDay && snap),
    });
  }

  const visitsByDay = visitsByDayFromSnapshots;

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
  type ChannelRow = { _id: "online" | "offline" | "b2b"; revenue: number; count: number };
  const channelMap = new Map<string, ChannelRow>(
    (onlineVsOfflineMix as ChannelRow[]).map((r) => [r._id, r])
  );
  const onlineRevenue = channelMap.get("online")?.revenue ?? 0;
  const offlineRevenue = channelMap.get("offline")?.revenue ?? 0;
  const b2bRevenue = channelMap.get("b2b")?.revenue ?? 0;
  const onlineCount = channelMap.get("online")?.count ?? 0;
  const offlineCount = channelMap.get("offline")?.count ?? 0;
  const b2bCount = channelMap.get("b2b")?.count ?? 0;

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

  const ordersBySource = (
    ordersBySourceRaw as { _id: string; orders: number; revenue: number }[]
  ).map((r) => ({
    source: r._id,
    orders: r.orders,
    revenue: Math.round(r.revenue * 100) / 100,
  }));

  const metaTracking = getMetaTrackingStatus();

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
      promotionDiscountTotal: promotionDiscountTotal[0]?.totalDiscount || 0,
      promotionDiscountMTD: promotionDiscountMTD[0]?.totalDiscount || 0,
      promotionOrdersTotal: promotionDiscountTotal[0]?.count || 0,
      saleDiscountTotal: saleDiscountTotal[0]?.totalDiscount || 0,
      saleOrdersTotal: saleDiscountTotal[0]?.count || 0,
      shippingCollected: orderFeesAgg[0]?.shipping || 0,
      codFeeCollected: orderFeesAgg[0]?.cod || 0,
      taxCollected: taxCollected[0]?.total || 0,
      onlineRevenue,
      offlineRevenue,
      b2bRevenue,
      onlineCount,
      offlineCount,
      b2bCount,
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
    visitsByDay,
    dailyMetrics,
    snapshotOverview: {
      periodDays: 30,
      completedDaysFromSnapshots: snapshots.length,
      totals: snapshotTotals,
    },
    visitInsights: {
      byCountry: visitStats.visitsByCountry,
      bySource: visitStats.visitsBySource,
      byDevice: visitStats.visitsByDevice,
      byLandingPage: visitStats.visitsByLandingPage,
      byCampaign: visitStats.visitsByCampaign,
      recent: visitStats.recentVisits,
    },
    marketingInsights: {
      metaTracking,
      attributedOrders: Number(attributedOrdersAgg) || 0,
      fbclidOrders: Number(fbclidOrdersAgg) || 0,
      ordersByCampaign,
      ordersBySource,
    },
    offerAttributionMtd,
    paymentMethodMix: (paymentMethodMix as { _id: string; revenue: number; count: number }[]),
    ordersByHour: ordersByHourFull,
    topVariantSizes: (topVariantSizes as { _id: string; units: number; revenue: number }[]),
    topVariantColors: (topVariantColors as { _id: string; units: number; revenue: number }[]),
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
