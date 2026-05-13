import Order from "../models/Order";
import User from "../models/User";
import Product from "../models/Product";
import Review from "../models/Review";
import { LOW_STOCK_ALERT_EXCLUSIVE_MAX } from "../constants/inventory";

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
    lowStockProducts,
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
    shippingCollected,
    codFeeCollected,
    taxCollected,
    cancellationCount,
    ordersByHour,
    topVariantSizes,
    repeatCustomersAgg,
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
    Product.aggregate([
      { $match: { isActive: true } },
      { $addFields: { computedTotal: { $sum: "$variants.stock" } } },
      { $match: { computedTotal: { $lt: LOW_STOCK_ALERT_EXCLUSIVE_MAX } } },
      { $sort: { computedTotal: 1 } },
      { $limit: 10 },
      { $project: { _id: 1, name: 1, category: 1, totalStock: "$computedTotal" } },
    ]),
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
    Product.find({ isActive: true }).sort({ viewCount: -1 }).limit(10).select("name slug images category viewCount price ratings").lean(),
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

    // ── NEW: Coupon discount totals ─────────────────────────────────────────
    Order.aggregate([
      { $match: { ...PAYMENT_STATUS_GROSS, discount: { $gt: 0 } } },
      { $group: { _id: null, totalDiscount: { $sum: "$discount" }, count: { $sum: 1 } } },
    ]),
    Order.aggregate([
      { $match: { ...PAYMENT_STATUS_GROSS, discount: { $gt: 0 }, createdAt: { $gte: startOfMonth } } },
      { $group: { _id: null, totalDiscount: { $sum: "$discount" }, count: { $sum: 1 } } },
    ]),

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

    // ── NEW: Shipping charges collected ────────────────────────────────────
    Order.aggregate([
      { $match: PAYMENT_STATUS_GROSS },
      { $group: { _id: null, total: { $sum: "$shippingCharge" } } },
    ]),

    // ── NEW: COD fees collected ─────────────────────────────────────────────
    Order.aggregate([
      { $match: PAYMENT_STATUS_GROSS },
      { $group: { _id: null, total: { $sum: "$codFee" } } },
    ]),

    // ── NEW: GST (output tax) collected on paid orders ──────────────────────
    Order.aggregate([
      { $match: { paymentStatus: "paid" } },
      { $group: { _id: null, total: { $sum: "$tax" } } },
    ]),

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
  ]);

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
  for (let i = 29; i >= 0; i--) {
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

  // ── Revenue growth ────────────────────────────────────────────────────────
  const currentMonthRevenue = monthRevenue[0]?.total || 0;
  const prevMonthRevenue = lastMonthRevenue[0]?.total || 0;
  const revenueGrowth = prevMonthRevenue > 0
    ? ((currentMonthRevenue - prevMonthRevenue) / prevMonthRevenue) * 100
    : 100;

  return {
    overview: {
      totalRevenue: totalRevenue[0]?.total || 0,
      monthRevenue: currentMonthRevenue,
      revenueGrowth: Math.round(revenueGrowth * 10) / 10,
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
      shippingCollected: shippingCollected[0]?.total || 0,
      codFeeCollected: codFeeCollected[0]?.total || 0,
      taxCollected: taxCollected[0]?.total || 0,
      onlineRevenue,
      offlineRevenue,
      onlineCount,
      offlineCount,
      repeatCustomers,
      totalCustomersWithOrders: totalCustomers,
      repeatRate,
      avgLtv,
    },
    refundsByReason,
    lowStockProducts,
    recentOrders,
    ordersByStatus,
    revenueByMonth,
    topProducts,
    topViewedProducts,
    revenueByCategory,
    revenueByDay,
    paymentMethodMix: (paymentMethodMix as { _id: string; revenue: number; count: number }[]),
    ordersByHour: ordersByHourFull,
    topVariantSizes: (topVariantSizes as { _id: string; units: number; revenue: number }[]),
  };
}
