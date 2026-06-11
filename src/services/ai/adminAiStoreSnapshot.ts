import {
  getOrderStatsForIstDayOffset,
  getOrderStatsForIstMonth,
} from "./istDayOrderStats";
import { istParts } from "../../types/utils/istDate";

type OperatingSummary = {
  yearTotal?: number;
  monthToDateTotal?: number;
  allTimeTotal?: number;
  byCategory?: Array<{
    category: string;
    label: string;
    total: number;
    count: number;
  }>;
} | null;

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function daysInMonth(year: number, monthIdx: number): number {
  return new Date(year, monthIdx + 1, 0).getDate();
}

export async function buildRichStoreSnapshot(
  analytics: Record<string, unknown>,
  operatingCosts: OperatingSummary,
  base: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const overview = (analytics.overview || {}) as Record<string, number>;
  const revenueByDay = (analytics.revenueByDay || []) as {
    date: string;
    revenue: number;
    orders: number;
  }[];

  const [todayStats, yesterdayStats, monthStats] = await Promise.all([
    getOrderStatsForIstDayOffset(0),
    getOrderStatsForIstDayOffset(-1),
    getOrderStatsForIstMonth(),
  ]);

  const paymentMethodMix = (
    (analytics.paymentMethodMix || []) as {
      _id: string;
      revenue: number;
      count: number;
    }[]
  )
    .slice(0, 6)
    .map((r) => ({
      method: r._id,
      orders: r.count,
      revenueInr: round2(r.revenue ?? 0),
    }));

  const ist = istParts(new Date());
  const dayOfMonth = ist.day;
  const dim = daysInMonth(ist.year, ist.month);
  const monthRev = overview.monthRevenue ?? 0;
  const avgDailyRev = dayOfMonth > 0 ? monthRev / dayOfMonth : 0;
  const daysLeft = Math.max(0, dim - dayOfMonth);
  const projectedMonthRevenue = round2(avgDailyRev * dim);

  const monthGross = overview.monthGrossProfit ?? 0;
  const opMtd = operatingCosts?.monthToDateTotal ?? 0;
  const opYear = operatingCosts?.yearTotal ?? 0;
  const estimatedNetMtd = round2(monthGross - opMtd);

  const byCategory = (operatingCosts?.byCategory || []).map((c) => ({
    category: c.category,
    label: c.label,
    totalYear: c.total,
    count: c.count,
  }));

  const packingPrintRelated = byCategory.filter((c) =>
    ["packing", "ads", "miscellaneous", "shipping_outbound", "other"].includes(
      c.category,
    ),
  );

  const topSellers = (
    (analytics.topProducts || []) as {
      name?: string;
      totalSold?: number;
      revenue?: number;
    }[]
  )
    .slice(0, 10)
    .map((p) => ({
      name: p.name,
      unitsSold: p.totalSold ?? 0,
      revenueInr: round2(p.revenue ?? 0),
    }));

  const topByProfit = (
    (analytics.topProductsByProfit || []) as {
      name?: string;
      unitsSold?: number;
      revenue?: number;
      profit?: number;
      marginPercent?: number;
    }[]
  )
    .slice(0, 10)
    .map((p) => ({
      name: p.name,
      unitsSold: p.unitsSold ?? 0,
      revenueInr: round2(p.revenue ?? 0),
      grossProfitInr: round2(p.profit ?? 0),
      marginPercent: p.marginPercent ?? 0,
    }));

  const revenueByMonth = (
    (analytics.revenueByMonth || []) as {
      _id?: { year: number; month: number };
      total?: number;
    }[]
  )
    .slice(-6)
    .map((r) => ({
      year: r._id?.year,
      month: r._id?.month,
      revenueInr: round2(r.total ?? 0),
    }));

  const profitByMonth = (
    (analytics.profitByMonth || []) as {
      _id?: { year: number; month: number };
      grossProfit?: number;
      productRevenue?: number;
    }[]
  )
    .slice(-6)
    .map((r) => ({
      year: r._id?.year,
      month: r._id?.month,
      grossProfitInr: round2(r.grossProfit ?? 0),
      productRevenueInr: round2(r.productRevenue ?? 0),
    }));

  const categoryProfit = (
    (analytics.categoryProfit || []) as {
      _id?: string;
      revenue?: number;
      profit?: number;
      marginPercent?: number;
    }[]
  )
    .slice(0, 8)
    .map((c) => ({
      category: c._id,
      revenueInr: round2(c.revenue ?? 0),
      profitInr: round2(c.profit ?? 0),
      marginPercent: c.marginPercent ?? 0,
    }));

  const topViewedRaw = analytics.topViewedProducts;
  const topViewedDetailed = (Array.isArray(topViewedRaw) ? topViewedRaw : [])
    .slice(0, 12)
    .map(
      (p: {
        name?: string;
        views?: number;
        viewCount?: number;
        sold?: number;
        conversionPercent?: number;
        conversionRate?: number;
        price?: number;
      }) => ({
        name: p.name,
        views: p.views ?? p.viewCount ?? 0,
        sold: p.sold ?? 0,
        conversionPercent: p.conversionPercent ?? p.conversionRate ?? 0,
        price: p.price,
      }),
    );

  const oos = (base.outOfStockAlerts || []) as {
    name?: string;
    soldCount?: number;
  }[];
  const low = (base.lowStockAlerts || []) as {
    name?: string;
    stock?: number;
    soldCount?: number;
  }[];

  const restockPriority = [
    ...oos
      .filter((p) => (p.soldCount ?? 0) >= 2)
      .map((p) => ({
        name: p.name,
        soldCount: p.soldCount,
        reason: "Out of stock + recent sales",
      })),
    ...low
      .filter((p) => (p.soldCount ?? 0) >= 1)
      .map((p) => ({
        name: p.name,
        stock: p.stock,
        soldCount: p.soldCount,
        reason: `Low stock (${p.stock ?? "?"} units)`,
      })),
  ].slice(0, 12);

  return {
    generatedAtIst: `${ist.year}-${String(ist.month + 1).padStart(2, "0")}-${String(ist.day).padStart(2, "0")}`,
    capabilities: [
      "Yesterday / today / this month — total + online + offline/POS + payment method (IST)",
      "Actual money: gross profit, operating costs, estimated net MTD",
      "Operating expenses by category (packing, ads, shipping, rent…)",
      "Top sellers, views, stock, returns",
      "Lifetime online vs offline split & month projection",
    ],
    dataGuide: {
      timezone: "Asia/Kolkata (IST)",
      ordersInclude:
        'All paid + refunded orders — website checkout AND offline/POS (offlineMeta). Not "online only".',
      today: "timePeriods.today — total + online + offline + paymentBreakdown",
      yesterday: "timePeriods.yesterday — same structure",
      thisMonth: "timePeriods.thisMonth — month-to-date with channel split",
      lifetime: "timePeriods.lifetime + channelMix.lifetime — all-time",
      forbidden: "NEVER compute yesterday as lifetime minus month",
      profit:
        "profitSummary — catalog gross profit; estimatedNetMtd subtracts operating costs",
      payments: "paymentBreakdown: razorpay, cod, offline_upi, offline_cash",
    },
    timePeriods: {
      today: todayStats,
      yesterday: yesterdayStats,
      thisMonth: {
        date: monthStats.date,
        orders: monthStats.orders,
        revenueInr: monthStats.revenueInr,
        online: monthStats.online,
        offline: monthStats.offline,
        paymentBreakdown: monthStats.paymentBreakdown,
        dayOfMonth,
        daysInMonth: dim,
        overviewMonthOrders: overview.monthOrders ?? 0,
        overviewMonthRevenue: overview.monthRevenue ?? 0,
      },
      lifetime: {
        orders: overview.totalOrders ?? 0,
        revenueInr: overview.totalRevenue ?? 0,
      },
    },
    profitSummary: {
      lifetimeGrossProfitInr: overview.grossProfit ?? 0,
      lifetimeGrossMarginPercent: overview.grossMarginPercent ?? 0,
      monthGrossProfitInr: monthGross,
      monthGrossMarginPercent: overview.monthGrossMarginPercent ?? 0,
      monthProductRevenueInr: overview.monthProductRevenue ?? 0,
      monthProductCogsInr: overview.monthProductCogs ?? 0,
      operatingCostsMtdInr: opMtd,
      operatingCostsYearInr: opYear,
      estimatedNetProfitMtdInr: estimatedNetMtd,
      note: "estimatedNetProfitMtd = monthGrossProfit - operatingCostsMtd (rough; excludes tax/refunds timing)",
    },
    operatingExpenses: {
      year: new Date().getFullYear(),
      yearTotalInr: opYear,
      monthToDateInr: opMtd,
      allTimeInr: operatingCosts?.allTimeTotal ?? 0,
      byCategory,
      packingAdsPrintRelated: packingPrintRelated,
      topSpendCategories: byCategory.slice(0, 5),
      adminPath: "/admin/operating-expenses",
    },
    projections: {
      avgDailyRevenueThisMonthInr: round2(avgDailyRev),
      projectedMonthRevenueInr: projectedMonthRevenue,
      daysLeftInMonth: daysLeft,
      monthRevenueGrowthPercent: overview.revenueGrowth ?? 0,
    },
    channelMix: {
      lifetime: {
        onlineRevenueInr: overview.onlineRevenue ?? 0,
        offlineRevenueInr: overview.offlineRevenue ?? 0,
        onlineOrders: overview.onlineCount ?? 0,
        offlineOrders: overview.offlineCount ?? 0,
      },
      monthToDate: {
        onlineOrders: monthStats.online.orders,
        offlineOrders: monthStats.offline.orders,
        onlineRevenueInr: monthStats.online.revenueInr,
        offlineRevenueInr: monthStats.offline.revenueInr,
      },
      paymentMethodMixLifetime: paymentMethodMix,
      repeatCustomerRatePercent: overview.repeatRate ?? 0,
      avgOrderValueInr: overview.avgOrderValue ?? 0,
    },
    returnsAndRisk: {
      refundedAmountInr: overview.refundedAmount ?? 0,
      refundedOrdersCount: overview.refundedOrdersCount ?? 0,
      pendingFulfillmentCount: overview.pendingFulfillmentCount ?? 0,
      cancellationRatePercent: overview.cancellationRate ?? 0,
      refundsByReason:
        Array.isArray(base.refundsByReason) ?
          base.refundsByReason.slice(0, 5)
        : [],
    },
    topSellersByUnits: topSellers,
    topProductsByProfit: topByProfit,
    topViewedProductsDetailed: topViewedDetailed,
    categoryProfit,
    revenueTrendLast7Days: revenueByDay.slice(-7),
    revenueByMonthLast6: revenueByMonth,
    profitByMonthLast6: profitByMonth,
    stockHealth: base.stockHealth,
    inventorySummary: base.inventorySummary,
    restockPriority,
    outOfStockAlerts: oos,
    lowStockAlerts: low,
  };
}
