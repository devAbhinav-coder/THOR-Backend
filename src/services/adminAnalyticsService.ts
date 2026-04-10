import Order from "../models/Order";
import User from "../models/User";
import Product from "../models/Product";
import Review from "../models/Review";
import { LOW_STOCK_ALERT_EXCLUSIVE_MAX } from "../constants/inventory";

export async function getDashboardAnalyticsData() {
  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const startOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const endOfLastMonth = new Date(now.getFullYear(), now.getMonth(), 0);
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());

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
  ] = await Promise.all([
    Order.aggregate([{ $match: { paymentStatus: "paid" } }, { $group: { _id: null, total: { $sum: "$total" } } }]),
    Order.aggregate([{ $match: { paymentStatus: "paid", createdAt: { $gte: startOfMonth } } }, { $group: { _id: null, total: { $sum: "$total" } } }]),
    Order.aggregate([{ $match: { paymentStatus: "paid", createdAt: { $gte: startOfLastMonth, $lte: endOfLastMonth } } }, { $group: { _id: null, total: { $sum: "$total" } } }]),
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
      { $match: { paymentStatus: "paid", createdAt: { $gte: new Date(now.getFullYear(), now.getMonth() - 11, 1) } } },
      { $group: { _id: { year: { $year: "$createdAt" }, month: { $month: "$createdAt" } }, revenue: { $sum: "$total" }, orders: { $sum: 1 } } },
      { $sort: { "_id.year": 1, "_id.month": 1 } },
    ]),
    Order.aggregate([
      { $match: { paymentStatus: "paid" } },
      { $unwind: "$items" },
      { $group: { _id: "$items.product", totalSold: { $sum: "$items.quantity" }, revenue: { $sum: { $multiply: ["$items.price", "$items.quantity"] } }, name: { $first: "$items.name" }, image: { $first: "$items.image" } } },
      { $sort: { totalSold: -1 } },
      { $limit: 5 },
    ]),
    Order.aggregate([{ $match: { paymentStatus: "paid" } }, { $group: { _id: null, avg: { $avg: "$total" } } }]),
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
      { $group: { _id: null, total: { $sum: "$refundData.amount" }, count: { $sum: 1 } } }
    ]),
    Order.aggregate([
      { $match: { returnStatus: { $in: ["requested", "approved", "returned"] }, "returnRequest.reason": { $exists: true } } },
      { $group: { _id: "$returnRequest.reason", count: { $sum: 1 } } }
    ]),
  ]);

  const currentMonthRevenue = monthRevenue[0]?.total || 0;
  const prevMonthRevenue = lastMonthRevenue[0]?.total || 0;
  const revenueGrowth =
    prevMonthRevenue > 0 ? ((currentMonthRevenue - prevMonthRevenue) / prevMonthRevenue) * 100 : 100;

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
      pendingFulfillmentCount,
      paidOrdersCount,
      totalReviews,
      reviewsThisMonth,
      refundedAmount: totalRefunds[0]?.total || 0,
      refundedOrdersCount: totalRefunds[0]?.count || 0,
    },
    refundsByReason,
    lowStockProducts,
    recentOrders,
    ordersByStatus,
    revenueByMonth,
    topProducts,
    topViewedProducts,
    revenueByCategory,
  };
}
