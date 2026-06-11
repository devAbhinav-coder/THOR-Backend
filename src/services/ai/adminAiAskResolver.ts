import { formatDayStatsBullets, type IstDayOrderStats } from './istDayOrderStats';

/** Deterministic answers from store JSON — avoids LLM guessing on numbers/dates. */

export type AskStoreContext = {
  currency?: string;
  overview?: Record<string, number>;
  timePeriods?: {
    today?: IstDayOrderStats;
    yesterday?: IstDayOrderStats;
    thisMonth?: IstDayOrderStats & {
      dayOfMonth?: number;
      daysInMonth?: number;
      overviewMonthOrders?: number;
      overviewMonthRevenue?: number;
    };
    lifetime?: { orders?: number; revenueInr?: number };
  };  profitSummary?: Record<string, number | string>;
  operatingExpenses?: {
    yearTotalInr?: number;
    monthToDateInr?: number;
    byCategory?: Array<{ label: string; totalYear: number; category: string }>;
    topSpendCategories?: Array<{ label: string; totalYear: number; category: string }>;
    packingAdsPrintRelated?: Array<{ label: string; totalYear: number; category: string }>;
    adminPath?: string;
  };
  projections?: Record<string, number>;
  channelMix?: {
    lifetime?: {
      onlineRevenueInr?: number;
      offlineRevenueInr?: number;
      onlineOrders?: number;
      offlineOrders?: number;
    };
    monthToDate?: {
      onlineRevenueInr?: number;
      offlineRevenueInr?: number;
      onlineOrders?: number;
      offlineOrders?: number;
    };
    paymentMethodMixLifetime?: Array<{ method: string; orders: number; revenueInr: number }>;
    repeatCustomerRatePercent?: number;
    avgOrderValueInr?: number;
  };
  returnsAndRisk?: Record<string, unknown>;
  topViewedProductsDetailed?: Array<{
    name?: string;
    views?: number;
    sold?: number;
    conversionPercent?: number;
  }>;
  topSellersByUnits?: Array<{ name?: string; unitsSold?: number; revenueInr?: number }>;
  topProductsByProfit?: Array<{
    name?: string;
    unitsSold?: number;
    revenueInr?: number;
    grossProfitInr?: number;
    marginPercent?: number;
  }>;
  outOfStockAlerts?: Array<{ name?: string; soldCount?: number }>;
  lowStockAlerts?: Array<{ name?: string; stock?: number; soldCount?: number }>;
  restockPriority?: Array<{ name?: string; reason?: string; soldCount?: number; stock?: number }>;
  stockHealth?: Record<string, number>;
  inventorySummary?: Record<string, unknown>;
  revenueTrendLast7Days?: Array<{ date: string; revenue: number; orders: number }>;
  revenueByMonthLast6?: Array<{ year?: number; month?: number; revenueInr?: number }>;
  finance?: Record<string, number>;
};

function normQ(q: string): string {
  return q
    .toLowerCase()
    .replace(/&amp;/g, ' and ')
    .replace(/[^\p{L}\p{N}\s?]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function fmtInr(n: number): string {
  return `₹${Math.round(n).toLocaleString('en-IN')}`;
}

function payload(text: string, bullets: string[], intro?: string) {
  const body = [intro || bullets[0] || text, ...bullets.map((b) => `• ${b}`)].filter(Boolean);
  return { text: body.join('\n'), bullets, intro: intro || bullets[0] };
}

function wantsYesterday(q: string): boolean {
  return /\b(kal|yesterday|last day|previous day|pichle din)\b/.test(q);
}

function wantsToday(q: string): boolean {
  return /\b(aaj|today)\b/.test(q);
}

function wantsMonth(q: string): boolean {
  return /\b(month|mahine|mahina|mtd|is mahine|this month)\b/.test(q) && !wantsYesterday(q);
}

function wantsYear(q: string): boolean {
  return /\b(year|saal|sal|annual|yearly|poora saal)\b/.test(q);
}

function wantsOrders(q: string): boolean {
  return /\b(order|orders|booking)\b/.test(q);
}

function wantsRevenue(q: string): boolean {
  return /\b(sales|sale|revenue|bikri|earning|turnover|value)\b/.test(q);
}

function wantsViews(q: string): boolean {
  return /\b(view|views|traffic|popular|dekha|dekh|visit)\b/.test(q) && !wantsTopSellers(q);
}

function wantsTopSellers(q: string): boolean {
  return (
    /\b(sold|selling|bikne|bika|best seller|top seller|units sold|kitna bika)\b/.test(q) ||
    (/\b(sabse|top|best)\b/.test(q) && /\b(bik|sell|product)\b/.test(q) && !/\bview\b/.test(q))
  );
}

function wantsRestock(q: string): boolean {
  return /\b(restock|stock|out of stock|low stock|inventory|priority)\b/.test(q);
}

function wantsProfit(q: string): boolean {
  return /\b(profit|margin|gross|net|munafa|actual|kitna bacha|earn)\b/.test(q);
}

function wantsOperating(q: string): boolean {
  return (
    /\b(operating|operation|expense|cost|kharcha|kharch|packing|print|ads|shipping|rent|utility|salary)\b/.test(
      q,
    ) || /\b(kahan kharch|kaha kharch|cost kahan)\b/.test(q)
  );
}

function wantsProjection(q: string): boolean {
  return /\b(future|forecast|projection|estimate|project|aage|end of month|mahine end)\b/.test(q);
}

function wantsSummary(q: string): boolean {
  return (
    /\b(summary|overview|sab batao|sab kuch|dashboard|business|kitna chal|kaisa chal|pulse|report)\b/.test(
      q,
    ) || q === 'help'
  );
}

function wantsGrowthAdvice(q: string): boolean {
  return (
    /\b(kaise|how|badha|badhau|increase|grow|improve|boost|tips|strategy|kya karu|kya karna)\b/.test(q) &&
    /\b(sales|sale|revenue|bikri|customer|service|conversion|business)\b/.test(q)
  );
}

function wantsChannel(q: string): boolean {
  return /\b(online|offline|pos|shop|channel|dukan|stall|counter)\b/.test(q);
}

function wantsMoneyFlow(q: string): boolean {
  return (
    /\b(actual|paisa|money|flow|kitna aaya|kitna kamaya|total business|pura business)\b/.test(q) &&
    !wantsProfit(q)
  );
}

function wantsReturns(q: string): boolean {
  return /\b(return|refund|cancel)\b/.test(q);
}

export function tryResolveAdminQuestion(
  question: string,
  ctx: AskStoreContext,
): { text: string; bullets: string[]; intro?: string } | null {
  const q = normQ(question);
  if (q.length < 3) return null;

  const tp = ctx.timePeriods || {};
  const o = ctx.overview || {};
  const ps = ctx.profitSummary || {};
  const op = ctx.operatingExpenses || {};
  const proj = ctx.projections || {};
  const ch = ctx.channelMix || {};

  // ── Full business snapshot ─────────────────────────────────────────────────
  if (wantsSummary(q) || wantsMoneyFlow(q)) {
    const y = tp.yesterday;
    const t = tp.today;
    const m = tp.thisMonth;
    const lt = ch.lifetime;
    const bullets = [
      `Today (${t?.date}): ${t?.orders ?? 0} orders — Online ${t?.online?.orders ?? 0}, Offline ${t?.offline?.orders ?? 0}`,
      ...(t ? formatDayStatsBullets(t).slice(1) : []),
      `Yesterday (${y?.date || '—'}): ${y?.orders ?? 0} orders — Online ${y?.online?.orders ?? 0}, Offline ${y?.offline?.orders ?? 0}, ${fmtInr(y?.revenueInr ?? 0)}`,
      `This month MTD: ${m?.orders ?? 0} orders — Online ${m?.online?.orders ?? 0}, Offline ${m?.offline?.orders ?? 0}, ${fmtInr(m?.revenueInr ?? 0)}`,
      `MTD gross profit: ${fmtInr(Number(ps.monthGrossProfitInr ?? 0))} | Operating MTD: ${fmtInr(Number(ps.operatingCostsMtdInr ?? 0))} | Est. net: ${fmtInr(Number(ps.estimatedNetProfitMtdInr ?? 0))}`,
      `Lifetime sales: Online ${fmtInr(lt?.onlineRevenueInr ?? 0)} (${lt?.onlineOrders ?? 0} ord) + Offline ${fmtInr(lt?.offlineRevenueInr ?? 0)} (${lt?.offlineOrders ?? 0} ord)`,
    ];
    return payload(
      'Full business snapshot (online + offline paid orders, IST):',
      bullets.slice(0, 8),
      'Business & cash flow',
    );
  }

  // ── Profit & net ───────────────────────────────────────────────────────────
  if (wantsProfit(q)) {
    const mtd = ch.monthToDate;
    const bullets = [
      `Sales MTD (paid, online+offline): ${fmtInr(mtd?.onlineRevenueInr ?? 0)} online + ${fmtInr(mtd?.offlineRevenueInr ?? 0)} offline`,
      `This month gross profit (after COGS): ${fmtInr(Number(ps.monthGrossProfitInr ?? 0))} — margin ${ps.monthGrossMarginPercent ?? 0}%`,
      `This month product revenue: ${fmtInr(Number(ps.monthProductRevenueInr ?? 0))} | COGS: ${fmtInr(Number(ps.monthProductCogsInr ?? 0))}`,
      `Operating costs MTD: ${fmtInr(Number(ps.operatingCostsMtdInr ?? 0))}`,
      `Estimated net MTD (gross − operating): ${fmtInr(Number(ps.estimatedNetProfitMtdInr ?? 0))}`,
      `Lifetime gross profit: ${fmtInr(Number(ps.lifetimeGrossProfitInr ?? 0))} (${ps.lifetimeGrossMarginPercent ?? 0}% margin)`,
    ];
    const topP = ctx.topProductsByProfit?.[0];
    if (topP?.name) {
      bullets.push(`Top profit product: ${topP.name} — ${fmtInr(topP.grossProfitInr ?? 0)} profit`);
    }
    return payload('Profit picture (catalog COGS + operating expenses):', bullets.slice(0, 6), 'Profit');
  }

  // ── Operating costs / print / packing ──────────────────────────────────────
  if (wantsOperating(q)) {
    const bullets: string[] = [];
    bullets.push(`Year total operating: ${fmtInr(op.yearTotalInr ?? 0)} | MTD: ${fmtInr(op.monthToDateInr ?? 0)}`);
    for (const c of (op.topSpendCategories || op.byCategory || []).slice(0, 6)) {
      bullets.push(`${c.label}: ${fmtInr(c.totalYear)} (year) — category: ${c.category}`);
    }
    const related = op.packingAdsPrintRelated || [];
    if (related.length > 0 && /\b(print|packing|ads)\b/.test(q)) {
      bullets.push(
        `Print/packing/marketing related: ${related.map((r) => `${r.label} ${fmtInr(r.totalYear)}`).join('; ')}`,
      );
    }
    bullets.push(`Detail entries: Admin → Operating expenses (${op.adminPath || '/admin/operating-expenses'})`);
    if (Number(ps.estimatedNetProfitMtdInr ?? 0) < 0) {
      bullets.push('Net MTD is negative — review the top 2 spend categories');
    } else {
      bullets.push('Cost control: try a 10–15% cap on the largest category before increasing ad spend');
    }
    return payload('Operating costs breakdown:', bullets.slice(0, 8), 'Operating costs');
  }

  // ── Projections ────────────────────────────────────────────────────────────
  if (wantsProjection(q) || (wantsMonth(q) && /\b(aage|future|end)\b/.test(q))) {
    const m = tp.thisMonth;
    const bullets = [
      `This month so far: ${fmtInr(m?.revenueInr ?? 0)} (${m?.dayOfMonth ?? 0}/${m?.daysInMonth ?? 30} days)`,
      `Avg daily revenue this month: ${fmtInr(proj.avgDailyRevenueThisMonthInr ?? 0)}`,
      `Projected full-month revenue (run-rate): ${fmtInr(proj.projectedMonthRevenueInr ?? 0)}`,
      `Days left in month: ${proj.daysLeftInMonth ?? 0}`,
      `Growth vs last month: ${proj.monthRevenueGrowthPercent ?? 0}%`,
    ];
    return payload('Month projection (simple run-rate, not guarantee):', bullets, 'Forecast');
  }

  // ── Yesterday ──────────────────────────────────────────────────────────────
  if (wantsYesterday(q) && (wantsOrders(q) || wantsRevenue(q) || q.includes('kitna'))) {
    const y = tp.yesterday;
    if (!y) return payload('Yesterday\'s data could not be loaded.', ['Restart the backend and try again']);
    const bullets = formatDayStatsBullets(y);
    if (y.orders > 0) bullets.push(`AOV: ${fmtInr(y.revenueInr / y.orders)}`);
    return payload(
      `Yesterday (${y.date}): ${y.orders} orders (online + offline), ${fmtInr(y.revenueInr)}.`,
      bullets,
      `Yesterday ${y.date}`,
    );
  }

  // ── Today ──────────────────────────────────────────────────────────────────
  if (wantsToday(q) && (wantsOrders(q) || wantsRevenue(q))) {
    const t = tp.today;
    if (!t) return payload('Today\'s data could not be loaded.', ['Retry in a moment']);
    return payload(
      `Today (${t.date}) so far: ${t.orders} orders, ${fmtInr(t.revenueInr)} (online + offline).`,
      formatDayStatsBullets(t),
      `Today ${t.date}`,
    );
  }

  // ── Month / year sales ─────────────────────────────────────────────────────
  if (wantsYear(q) && (wantsRevenue(q) || wantsOrders(q))) {
    const bullets = [
      `Lifetime orders: ${tp.lifetime?.orders ?? 0} | Revenue: ${fmtInr(tp.lifetime?.revenueInr ?? 0)}`,
      `Operating costs (calendar year): ${fmtInr(op.yearTotalInr ?? 0)}`,
      `Lifetime gross profit: ${fmtInr(Number(ps.lifetimeGrossProfitInr ?? 0))}`,
    ];
    for (const row of (ctx.revenueByMonthLast6 || []).slice(-3)) {
      bullets.push(`Month ${row.month}/${row.year}: ${fmtInr(row.revenueInr ?? 0)} revenue`);
    }
    return payload('Year / lifetime snapshot:', bullets, 'Yearly');
  }

  if (wantsMonth(q) && (wantsOrders(q) || wantsRevenue(q))) {
    const m = tp.thisMonth;
    if (!m) return null;
    const bullets = formatDayStatsBullets(m);
    bullets.push(`Growth vs last month: ${o.revenueGrowth ?? 0}%`);
    bullets.push(`Projected month-end (run-rate): ${fmtInr(proj.projectedMonthRevenueInr ?? 0)}`);
    return payload(
      `This month (IST): ${m.orders} orders, ${fmtInr(m.revenueInr)} — online + offline.`,
      bullets,
      'This month MTD',
    );
  }

  // ── Top sellers ────────────────────────────────────────────────────────────
  if (wantsTopSellers(q)) {
    const list = ctx.topSellersByUnits || [];
    if (list.length === 0) return payload('Top seller data is empty.', ['Check paid orders in the system']);
    const top = list[0];
    const bullets = list.slice(0, 8).map(
      (p, i) => `${i + 1}. ${p.name} — ${p.unitsSold ?? 0} units, ${fmtInr(p.revenueInr ?? 0)}`,
    );
    return payload(`Best seller: ${top.name} (${top.unitsSold} units).`, bullets, 'Top sellers');
  }

  // ── Top views ──────────────────────────────────────────────────────────────
  if (wantsViews(q) || ((q.includes('sabse') || q.includes('zyada')) && q.includes('view'))) {
    const list = ctx.topViewedProductsDetailed || [];
    if (list.length === 0) return payload('View data not found.', ['Refresh analytics']);
    const top = list[0];
    const bullets = list.slice(0, 8).map(
      (p, i) => `${i + 1}. ${p.name} — ${p.views ?? 0} views, ${p.sold ?? 0} sold (${p.conversionPercent ?? 0}% conv)`,
    );
    return payload(`Top views: ${top.name} (${top.views} views).`, bullets, 'Top views');
  }

  // ── Online vs offline ──────────────────────────────────────────────────────
  if (wantsChannel(q)) {
    const lt = ch.lifetime;
    const mtd = ch.monthToDate;
    const bullets = [
      `This month — Online: ${mtd?.onlineOrders ?? 0} orders, ${fmtInr(mtd?.onlineRevenueInr ?? 0)}`,
      `This month — Offline/POS: ${mtd?.offlineOrders ?? 0} orders, ${fmtInr(mtd?.offlineRevenueInr ?? 0)}`,
      `Lifetime — Online: ${lt?.onlineOrders ?? 0} orders, ${fmtInr(lt?.onlineRevenueInr ?? 0)}`,
      `Lifetime — Offline/POS: ${lt?.offlineOrders ?? 0} orders, ${fmtInr(lt?.offlineRevenueInr ?? 0)}`,
      `Avg order value (lifetime): ${fmtInr(ch.avgOrderValueInr ?? 0)}`,
    ];
    for (const p of ch.paymentMethodMixLifetime || []) {
      bullets.push(`Payment ${p.method}: ${p.orders} orders, ${fmtInr(p.revenueInr)}`);
    }
    return payload('Online + offline channels (paid orders):', bullets.slice(0, 8), 'Channel mix');
  }

  // ── Returns ────────────────────────────────────────────────────────────────
  if (wantsReturns(q)) {
    const r = ctx.returnsAndRisk || {};
    return payload('Returns & cancellations:', [
      `Refunded: ${fmtInr(Number(r.refundedAmountInr ?? 0))} (${r.refundedOrdersCount ?? 0} orders)`,
      `Cancellation rate: ${r.cancellationRatePercent ?? 0}%`,
      `Pending fulfilment: ${r.pendingFulfillmentCount ?? 0} orders`,
    ]);
  }

  // ── Restock ────────────────────────────────────────────────────────────────
  if (wantsRestock(q)) {
    const priority = ctx.restockPriority || [];
    const oos = ctx.outOfStockAlerts || [];
    const low = ctx.lowStockAlerts || [];
    const bullets: string[] = [];
    for (const p of priority.slice(0, 6)) {
      bullets.push(`${p.name}: ${p.reason || 'restock'}`);
    }
    if (bullets.length === 0) {
      for (const p of oos.slice(0, 4)) bullets.push(`OOS: ${p.name}`);
      for (const p of low.slice(0, 4)) bullets.push(`Low: ${p.name} (${p.stock} left)`);
    }
    const inv = ctx.inventorySummary as Record<string, number> | undefined;
    if (inv?.totalInventoryValue) {
      bullets.push(`Inventory value (approx): ${fmtInr(inv.totalInventoryValue)}`);
    }
    return payload(
      `${oos.length} OOS, ${low.length} low stock.`,
      bullets.length ? bullets : ['Stock healthy'],
      'Restock',
    );
  }

  // ── Growth advice (data-backed) ──────────────────────────────────────────
  if (wantsGrowthAdvice(q)) {
    const bullets: string[] = [];
    const top = ctx.topViewedProductsDetailed || [];
    const oosList = ctx.outOfStockAlerts || [];
    const pending = Number(ctx.returnsAndRisk?.pendingFulfillmentCount ?? 0);
    const repeat = ch.repeatCustomerRatePercent ?? 0;
    const growth = proj.monthRevenueGrowthPercent ?? o.revenueGrowth ?? 0;
    const net = Number(ps.estimatedNetProfitMtdInr ?? 0);

    if (net < 0) {
      bullets.push(`Net MTD ${fmtInr(net)} — control operating costs (${fmtInr(op.monthToDateInr ?? 0)}) first`);
    }
    if (top.length > 0) {
      const weak = top.filter((p) => (p.views ?? 0) >= 15 && (p.conversionPercent ?? 100) < 2);
      if (weak.length > 0) {
        bullets.push(`Fix conversion: ${weak.slice(0, 2).map((p) => p.name).join(', ')}`);
      }
      bullets.push(`Push ads on: ${top.slice(0, 2).map((p) => p.name).join(', ')}`);
    }
    const best = ctx.topSellersByUnits?.[0];
    if (best?.name) bullets.push(`Best seller ${best.name} — stock + similar listings`);
    for (const p of oosList.filter((x) => (x.soldCount ?? 0) >= 2).slice(0, 2)) {
      bullets.push(`Restock ${p.name} (had sales, now OOS)`);
    }
    if (pending > 0) bullets.push(`Ship ${pending} queued orders first`);
    bullets.push(
      repeat >= 25
        ? `Repeat rate ${repeat}% — offer VIP buyers early access`
        : `Repeat rate ${repeat}% — send follow-up WhatsApp after delivery`,
    );
    if (growth < 0) bullets.push(`Revenue ${growth}% vs last month — festival bundle on top 3 SKUs`);
    if (bullets.length === 0) return null;
    return payload('Action items based on your data:', bullets.slice(0, 7), 'Next steps');
  }

  return null;
}

export function isTimeSensitiveQuestion(question: string): boolean {
  const q = normQ(question);
  return (
    wantsYesterday(q) ||
    wantsToday(q) ||
    (wantsMonth(q) && (wantsOrders(q) || wantsRevenue(q))) ||
    /\b(kal|aaj|yesterday|today|kitna order)\b/.test(q)
  );
}
