import Order from "../models/Order";
import { istEndOfDay, istMidnight, istParts } from "../types/utils/istDate";
import {
  PAYMENT_STATUS_GROSS,
  couponDiscountPipeline,
  promotionDiscountPipeline,
  saleDiscountPipeline,
  orderFeesPipeline,
  taxCollectedPipeline,
} from "./orderFinanceAggregations";
import { getOfferAttributionSummary } from "./offerAttributionService";
import { paidOrderLineProfitStages } from "./orderProfitAggregationHelpers";
import { ORDER_CHANNEL_SWITCH, orderChannelFilterLabel, orderChannelMatch, type OrderSalesChannelFilter } from "../utils/orderChannel";

const IST_TZ = "Asia/Kolkata";

export type RevenuePeriod = "month" | "year" | "lifetime";

export function resolveRevenuePeriodBounds(
  period: RevenuePeriod,
  year?: number,
  month?: number,
): {
  start: Date | null;
  end: Date;
  label: string;
  chartStart: Date;
  year: number;
  month: number;
} {
  const now = new Date();
  const ist = istParts(now);
  const y = year ?? ist.year;
  const m = month ?? ist.month + 1;

  if (period === "lifetime") {
    const chartStart = istMidnight(ist.year, ist.month - 35, 1);
    return {
      start: null,
      end: now,
      chartStart,
      label: "All time (lifetime)",
      year: y,
      month: m,
    };
  }

  if (period === "year") {
    const start = istMidnight(y, 0, 1);
    const end = y < ist.year ? istEndOfDay(y, 11, 31) : now;
    return {
      start,
      end,
      chartStart: start,
      label: `Calendar year ${y}`,
      year: y,
      month: m,
    };
  }

  const monthIdx = m - 1;
  const start = istMidnight(y, monthIdx, 1);
  const lastDay = new Date(y, m, 0).getDate();
  const end =
    y === ist.year && m === ist.month + 1 ?
      now
    : istEndOfDay(y, monthIdx, lastDay);
  const monthLabel = new Intl.DateTimeFormat("en-IN", {
    month: "long",
    year: "numeric",
  }).format(new Date(`${y}-${String(m).padStart(2, "0")}-15T12:00:00+05:30`));
  const chartStart = istMidnight(y, monthIdx - 11, 1);
  return {
    start,
    end,
    chartStart,
    label: monthLabel,
    year: y,
    month: m,
  };
}

function orderDateMatch(bounds: { start: Date | null; end: Date }) {
  const range: Record<string, Date> = { $lte: bounds.end };
  if (bounds.start) range.$gte = bounds.start;
  return { createdAt: range };
}

function refundDateMatch(bounds: { start: Date | null; end: Date }) {
  const range: Record<string, Date> = { $lte: bounds.end };
  if (bounds.start) range.$gte = bounds.start;
  return { refundAt: range };
}

export async function getRevenuePeriodSummary(
  period: RevenuePeriod,
  options?: { year?: number; month?: number; channel?: OrderSalesChannelFilter },
) {
  const bounds = resolveRevenuePeriodBounds(
    period,
    options?.year,
    options?.month,
  );
  const channel = options?.channel ?? "all";
  const channelMatch = orderChannelMatch(channel);
  const orderMatch = { ...orderDateMatch(bounds), ...channelMatch };
  const chartOrderMatch = {
    ...orderDateMatch({
      start: bounds.chartStart,
      end: bounds.end,
    }),
    ...channelMatch,
  };
  const channelSuffix = orderChannelFilterLabel(channel);
  const periodLabel =
    channelSuffix ? `${bounds.label} · ${channelSuffix}` : bounds.label;

  const refundStages = [
    { $match: { "refundData.amount": { $gt: 0 } } },
    {
      $addFields: {
        refundAt: { $ifNull: ["$refundData.processedAt", "$updatedAt"] },
      },
    },
  ];

  const [
    grossAgg,
    refundsAgg,
    profitAgg,
    revenueByMonth,
    profitByMonth,
    refundsByMonth,
    topProductsByProfit,
    categoryProfit,
    orderCountAgg,
    couponAgg,
    promoAgg,
    saleAgg,
    orderFeesAgg,
    taxAgg,
    feesRetainedAgg,
    paymentMethodMix,
    channelMixAgg,
    offerAttribution,
  ] = await Promise.all([
    Order.aggregate([
      { $match: { ...PAYMENT_STATUS_GROSS, ...orderMatch } },
      { $group: { _id: null, total: { $sum: "$total" }, orders: { $sum: 1 } } },
    ]),
    Order.aggregate([
      ...refundStages,
      { $match: { ...refundDateMatch(bounds), ...channelMatch } },
      {
        $group: {
          _id: null,
          total: { $sum: "$refundData.amount" },
          count: { $sum: 1 },
        },
      },
    ]),
    Order.aggregate([
      ...paidOrderLineProfitStages(orderMatch),
      {
        $group: {
          _id: null,
          productRevenue: { $sum: "$lineRevenue" },
          cogs: { $sum: "$lineCogs" },
          grossProfit: { $sum: "$lineProfit" },
        },
      },
    ]),
    Order.aggregate([
      { $match: { ...PAYMENT_STATUS_GROSS, ...chartOrderMatch } },
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
      ...paidOrderLineProfitStages(chartOrderMatch),
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
      { $sort: { "_id.year": 1, "_id.month": 1 } },
    ]),
    Order.aggregate([
      ...refundStages,
      {
        $match: {
          ...refundDateMatch({ start: bounds.chartStart, end: bounds.end }),
          ...channelMatch,
        },
      },
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
      { $sort: { "_id.year": 1, "_id.month": 1 } },
    ]),
    Order.aggregate([
      ...paidOrderLineProfitStages(orderMatch),
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
          orderLines: { $sum: 1 },
          linesMissingCost: {
            $sum: { $cond: ["$hasCostData", 0, 1] },
          },
        },
      },
      {
        $addFields: {
          marginPercent: {
            $cond: [
              { $gt: ["$revenue", 0] },
              {
                $round: [
                  { $multiply: [{ $divide: ["$profit", "$revenue"] }, 100] },
                  1,
                ],
              },
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
      { $limit: 30 },
    ]),
    Order.aggregate([
      ...paidOrderLineProfitStages(orderMatch),
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
              {
                $round: [
                  { $multiply: [{ $divide: ["$profit", "$revenue"] }, 100] },
                  1,
                ],
              },
              0,
            ],
          },
        },
      },
      { $sort: { profit: -1 } },
      { $limit: 12 },
    ]),
    Order.aggregate([
      { $match: { ...PAYMENT_STATUS_GROSS, ...orderMatch } },
      { $group: { _id: null, count: { $sum: 1 } } },
    ]),
    Order.aggregate(couponDiscountPipeline(orderMatch)),
    Order.aggregate(promotionDiscountPipeline(orderMatch)),
    Order.aggregate(saleDiscountPipeline(orderMatch)),
    Order.aggregate(orderFeesPipeline(orderMatch)),
    Order.aggregate(taxCollectedPipeline(orderMatch)),
    Order.aggregate([
      ...refundStages,
      {
        $match: {
          ...refundDateMatch(bounds),
          ...channelMatch,
          "refundData.nonRefundableFees": { $gt: 0 },
        },
      },
      {
        $group: { _id: null, total: { $sum: "$refundData.nonRefundableFees" } },
      },
    ]),
    Order.aggregate([
      { $match: { ...PAYMENT_STATUS_GROSS, ...orderMatch } },
      {
        $group: {
          _id: "$paymentMethod",
          revenue: { $sum: "$total" },
          count: { $sum: 1 },
        },
      },
      { $sort: { revenue: -1 } },
    ]),
    Order.aggregate([
      { $match: { ...PAYMENT_STATUS_GROSS, ...orderMatch } },
      {
        $group: {
          _id: ORDER_CHANNEL_SWITCH,
          revenue: { $sum: "$total" },
          count: { $sum: 1 },
        },
      },
    ]),
    getOfferAttributionSummary(bounds),
  ]);

  const grossRevenue = Math.round((grossAgg[0]?.total ?? 0) * 100) / 100;
  const refunds = Math.round((refundsAgg[0]?.total ?? 0) * 100) / 100;
  const netRevenue = Math.max(
    0,
    Math.round((grossRevenue - refunds) * 100) / 100,
  );
  const pl = profitAgg[0] as
    | { productRevenue?: number; cogs?: number; grossProfit?: number }
    | undefined;
  const productRevenue = Math.round((pl?.productRevenue ?? 0) * 100) / 100;
  const cogs = Math.round((pl?.cogs ?? 0) * 100) / 100;
  const grossProfit = Math.round((pl?.grossProfit ?? 0) * 100) / 100;
  const grossMarginPercent =
    productRevenue > 0 ?
      Math.round((grossProfit / productRevenue) * 1000) / 10
    : 0;

  const filterChartMonth = (
    rows: { _id: { year: number; month: number } }[],
  ) => {
    if (period === "year") {
      return rows.filter((r) => r._id.year === bounds.year);
    }
    if (period === "month") {
      return rows;
    }
    return rows;
  };

  return {
    period,
    year: bounds.year,
    month: bounds.month,
    label: periodLabel,
    channel,
    overview: {
      grossRevenue,
      netRevenue,
      refunds,
      refundedOrdersCount: refundsAgg[0]?.count ?? 0,
      productRevenue,
      cogs,
      grossProfit,
      grossMarginPercent,
      orders: orderCountAgg[0]?.count ?? grossAgg[0]?.orders ?? 0,
      couponDiscountTotal:
        Math.round((couponAgg[0]?.totalDiscount ?? 0) * 100) / 100,
      couponOrdersCount: couponAgg[0]?.count ?? 0,
      promotionDiscountTotal:
        Math.round((promoAgg[0]?.totalDiscount ?? 0) * 100) / 100,
      promotionOrdersCount: promoAgg[0]?.count ?? 0,
      saleDiscountTotal:
        Math.round((saleAgg[0]?.totalDiscount ?? 0) * 100) / 100,
      saleOrdersCount: saleAgg[0]?.count ?? 0,
      shippingCollected:
        Math.round((orderFeesAgg[0]?.shipping ?? 0) * 100) / 100,
      codFeeCollected: Math.round((orderFeesAgg[0]?.cod ?? 0) * 100) / 100,
      taxCollected: Math.round((taxAgg[0]?.total ?? 0) * 100) / 100,
      nonRefundableFeesRetained:
        Math.round((feesRetainedAgg[0]?.total ?? 0) * 100) / 100,
    },
    revenueByMonth: filterChartMonth(
      revenueByMonth as {
        _id: { year: number; month: number };
        revenue: number;
        orders: number;
      }[],
    ),
    profitByMonth: filterChartMonth(
      profitByMonth as {
        _id: { year: number; month: number };
        productRevenue: number;
        cogs: number;
        grossProfit: number;
      }[],
    ),
    refundsByMonth: filterChartMonth(
      refundsByMonth as {
        _id: { year: number; month: number };
        refunds: number;
        count: number;
      }[],
    ),
    topProductsByProfit,
    categoryProfit,
    paymentMethodMix: paymentMethodMix as {
      _id: string;
      revenue: number;
      count: number;
    }[],
    channelMix: (() => {
      type Row = { _id: "online" | "offline" | "b2b"; revenue: number; count: number };
      const rows = channelMixAgg as Row[];
      const map = new Map(rows.map((r) => [r._id, r]));
      return {
        onlineRevenue: map.get("online")?.revenue ?? 0,
        offlineRevenue: map.get("offline")?.revenue ?? 0,
        b2bRevenue: map.get("b2b")?.revenue ?? 0,
        onlineCount: map.get("online")?.count ?? 0,
        offlineCount: map.get("offline")?.count ?? 0,
        b2bCount: map.get("b2b")?.count ?? 0,
      };
    })(),
    offerAttribution,
  };
}
