import Order from "../../models/Order";
import { istEndOfDay, istMidnight, istParts } from "../../types/utils/istDate";

/** Paid + refunded gross revenue (online checkout + offline/POS). */
const PAYMENT_STATUS_GROSS = {
  paymentStatus: { $in: ["paid", "refunded"] as const },
};

const PAYMENT_LABELS: Record<string, string> = {
  razorpay: "Online — Razorpay/UPI",
  cod: "Online — COD",
  offline_upi: "Offline — UPI",
  offline_cash: "Offline — Cash",
};

export type DayChannelStats = {
  orders: number;
  revenueInr: number;
};

export type IstDayOrderStats = {
  date: string;
  orders: number;
  revenueInr: number;
  online: DayChannelStats;
  offline: DayChannelStats;
  paymentBreakdown: Array<{
    method: string;
    label: string;
    orders: number;
    revenueInr: number;
  }>;
};

/** Format YYYY-MM-DD in Asia/Kolkata for a given instant. */
export function istDateString(date: Date): string {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

/** Calendar day in IST: 0 = today, -1 = yesterday, etc. */
export function istDayBoundsFromOffset(dayOffset: number): {
  date: string;
  start: Date;
  end: Date;
} {
  const now = new Date();
  const ist = istParts(now);
  const anchorMs =
    istMidnight(ist.year, ist.month, ist.day).getTime() + dayOffset * 86400000;
  const anchor = new Date(anchorMs);
  const p = istParts(anchor);
  const start = istMidnight(p.year, p.month, p.day);
  const end = istEndOfDay(p.year, p.month, p.day);
  return { date: istDateString(anchor), start, end };
}

function istMonthBounds(): { start: Date; end: Date; label: string } {
  const ist = istParts(new Date());
  const start = istMidnight(ist.year, ist.month, 1);
  const end = istEndOfDay(ist.year, ist.month, ist.day);
  return {
    start,
    end,
    label: `${ist.year}-${String(ist.month + 1).padStart(2, "0")}`,
  };
}

function foldDayAggregation(
  rows: {
    _id: { channel: string; paymentMethod?: string };
    orders: number;
    revenue: number;
  }[],
  date: string,
): IstDayOrderStats {
  let orders = 0;
  let revenueInr = 0;
  const online: DayChannelStats = { orders: 0, revenueInr: 0 };
  const offline: DayChannelStats = { orders: 0, revenueInr: 0 };
  const payMap = new Map<string, { orders: number; revenue: number }>();

  for (const r of rows) {
    const o = r.orders ?? 0;
    const rev = Math.round((r.revenue ?? 0) * 100) / 100;
    orders += o;
    revenueInr += rev;
    if (r._id.channel === "offline") {
      offline.orders += o;
      offline.revenueInr += rev;
    } else {
      online.orders += o;
      online.revenueInr += rev;
    }
    const method = String(r._id.paymentMethod || "unknown");
    const prev = payMap.get(method) || { orders: 0, revenue: 0 };
    payMap.set(method, {
      orders: prev.orders + o,
      revenue: prev.revenue + rev,
    });
  }

  revenueInr = Math.round(revenueInr * 100) / 100;
  online.revenueInr = Math.round(online.revenueInr * 100) / 100;
  offline.revenueInr = Math.round(offline.revenueInr * 100) / 100;

  const paymentBreakdown = [...payMap.entries()]
    .map(([method, v]) => ({
      method,
      label: PAYMENT_LABELS[method] || method,
      orders: v.orders,
      revenueInr: Math.round(v.revenue * 100) / 100,
    }))
    .sort((a, b) => b.revenueInr - a.revenueInr);

  return { date, orders, revenueInr, online, offline, paymentBreakdown };
}

async function aggregateOrdersInRange(
  start: Date,
  end: Date,
  dateLabel: string,
): Promise<IstDayOrderStats> {
  const rows = await Order.aggregate([
    {
      $match: {
        ...PAYMENT_STATUS_GROSS,
        createdAt: { $gte: start, $lte: end },
      },
    },
    {
      $group: {
        _id: {
          channel: {
            $cond: [{ $ifNull: ["$offlineMeta", false] }, "offline", "online"],
          },
          paymentMethod: "$paymentMethod",
        },
        orders: { $sum: 1 },
        revenue: { $sum: "$total" },
      },
    },
  ]);

  return foldDayAggregation(rows, dateLabel);
}

/** 0 = today, -1 = yesterday (IST). Includes online + offline/POS paid orders. */
export async function getOrderStatsForIstDayOffset(
  dayOffset: number,
): Promise<IstDayOrderStats> {
  const { date, start, end } = istDayBoundsFromOffset(dayOffset);
  return aggregateOrdersInRange(start, end, date);
}

/** Current calendar month in IST (paid + refunded). */
export async function getOrderStatsForIstMonth(): Promise<IstDayOrderStats> {
  const { start, end, label } = istMonthBounds();
  return aggregateOrdersInRange(start, end, label);
}

export function formatDayStatsBullets(stats: IstDayOrderStats): string[] {
  const bullets: string[] = [
    `Total: ${stats.orders} orders, ${fmtInr(stats.revenueInr)} (online + offline, paid)`,
    `Online: ${stats.online.orders} orders, ${fmtInr(stats.online.revenueInr)}`,
    `Offline / POS: ${stats.offline.orders} orders, ${fmtInr(stats.offline.revenueInr)}`,
  ];
  for (const p of stats.paymentBreakdown.slice(0, 5)) {
    bullets.push(`${p.label}: ${p.orders} orders, ${fmtInr(p.revenueInr)}`);
  }
  return bullets;
}

function fmtInr(n: number): string {
  return `₹${Math.round(n).toLocaleString("en-IN")}`;
}
