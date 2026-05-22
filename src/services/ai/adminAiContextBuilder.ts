import { Types } from 'mongoose';
import Order from '../../models/Order';
import User from '../../models/User';
import Review from '../../models/Review';
import Product from '../../models/Product';
import { getDashboardAnalyticsData } from '../adminAnalyticsService';
import { buildRichStoreSnapshot } from './adminAiStoreSnapshot';
import { getInventorySummaryStats } from '../inventory/inventoryCacheService';
import { getOperatingExpenseSummary } from '../operatingExpenseService';
import { getCache } from '../cacheService';

const RETURNS_INSIGHTS_CACHE_KEY = 'analytics:returns:insights';

export type RuleAction = {
  id: string;
  priority: 'high' | 'medium' | 'low';
  title: string;
  detail: string;
  href?: string;
};

function roundInr(n: number): number {
  return Math.round(n * 100) / 100;
}

export async function buildDashboardContext(): Promise<Record<string, unknown>> {
  const year = new Date().getFullYear();
  const [analytics, inventory, operatingCosts] = await Promise.all([
    getDashboardAnalyticsData(),
    getInventorySummaryStats().catch(() => ({})),
    getOperatingExpenseSummary({ year }).catch(() => null),
  ]);

  const overview = analytics.overview as Record<string, number>;

  const lowStock = (analytics.lowStockOnlyProducts || analytics.lowStockProducts || [])
    .filter((p: { totalStock?: number }) => (p.totalStock ?? 0) > 0)
    .slice(0, 8)
    .map((p: { name?: string; totalStock?: number; soldCount?: number }) => ({
      name: p.name,
      stock: p.totalStock,
      soldCount: (p as { soldCount?: number }).soldCount,
    }));

  const outOfStock = (analytics.outOfStockProducts || [])
    .slice(0, 8)
    .map((p: { name?: string; soldCount?: number }) => ({
      name: p.name,
      soldCount: (p as { soldCount?: number }).soldCount,
    }));

  const topViewed = (analytics.topViewedProducts || []).slice(0, 6).map(
    (p: {
      name?: string;
      viewCount?: number;
      conversionRate?: number;
      soldCount?: number;
    }) => ({
      name: p.name,
      views: p.viewCount,
      conversionPct: p.conversionRate,
      sold: p.soldCount,
    }),
  );

  const refundsByReason = (analytics.refundsByReason || []).slice(0, 5);

  const finance = {
    grossProfitLifetime: overview.grossProfit ?? 0,
    grossMarginPercent: overview.grossMarginPercent ?? 0,
    monthGrossProfit: overview.monthGrossProfit ?? 0,
    monthGrossMarginPercent: overview.monthGrossMarginPercent ?? 0,
    monthProductRevenue: overview.monthProductRevenue ?? 0,
    productRevenueLifetime: overview.productRevenue ?? 0,
    productCogsLifetime: overview.productCogs ?? 0,
    operatingCostsYear: operatingCosts?.yearTotal ?? 0,
    operatingCostsMtd: operatingCosts?.monthToDateTotal ?? 0,
    operatingCostsTopCategories: (operatingCosts?.byCategory ?? [])
      .slice(0, 4)
      .map((c: { label: string; total: number }) => ({
        label: c.label,
        total: c.total,
      })),
  };

  return {
    store: 'The House of Rani',
    currency: 'INR',
    overview: analytics.overview,
    finance,
    stockHealth: analytics.stockHealth,
    lowStockAlerts: lowStock,
    outOfStockAlerts: outOfStock,
    topViewedProducts: topViewed,
    refundsByReason,
    inventorySummary: {
      totalProducts: (inventory as Record<string, unknown>).totalProducts,
      outOfStock: (inventory as Record<string, unknown>).outOfStock,
      lowStock: (inventory as Record<string, unknown>).lowStock,
      totalInventoryValue: (inventory as Record<string, unknown>).totalInventoryValue,
    },
    recentOrdersCount: analytics.recentOrders?.length ?? 0,
  };
}

export function computeRuleBasedActions(ctx: Record<string, unknown>): RuleAction[] {
  const actions: RuleAction[] = [];
  const overview = (ctx.overview || {}) as Record<string, number>;
  const low = (ctx.lowStockAlerts || []) as { name?: string; soldCount?: number }[];
  const out = (ctx.outOfStockAlerts || []) as { name?: string; soldCount?: number }[];
  const topViewed = (ctx.topViewedProducts || []) as {
    name?: string;
    conversionPct?: number;
    views?: number;
  }[];

  if ((overview.pendingFulfillmentCount ?? 0) > 0) {
    actions.push({
      id: 'fulfil-queue',
      priority: 'high',
      title: 'Clear fulfilment queue',
      detail: `${overview.pendingFulfillmentCount} orders need shipping/processing attention.`,
      href: '/admin/orders?status=processing',
    });
  }

  for (const p of out.filter((x) => (x.soldCount ?? 0) >= 3).slice(0, 3)) {
    actions.push({
      id: `oos-${p.name}`,
      priority: 'high',
      title: `Restock: ${p.name}`,
      detail: 'Out of stock but had recent sales — restock priority.',
      href: '/admin/inventory',
    });
  }

  for (const p of low.slice(0, 3)) {
    actions.push({
      id: `low-${p.name}`,
      priority: 'medium',
      title: `Low stock: ${p.name}`,
      detail: `Only ${(p as { stock?: number }).stock ?? 'few'} units left.`,
      href: '/admin/inventory',
    });
  }

  const avgConv =
    topViewed.length > 0
      ? topViewed.reduce((s, r) => s + (r.conversionPct ?? 0), 0) / topViewed.length
      : 0;

  for (const p of topViewed) {
    if ((p.views ?? 0) >= 20 && (p.conversionPct ?? 100) < avgConv * 0.6) {
      actions.push({
        id: `conv-${p.name}`,
        priority: 'medium',
        title: `Improve listing: ${p.name}`,
        detail: 'High views but weak conversion — check price, images, stock.',
        href: '/admin/products',
      });
    }
  }

  if ((overview.revenueGrowth ?? 0) < -10) {
    actions.push({
      id: 'revenue-dip',
      priority: 'high',
      title: 'Revenue dipped vs last month',
      detail: `Month revenue growth is ${overview.revenueGrowth}%. Review campaigns and top sellers.`,
      href: '/admin/analytics',
    });
  }

  if ((overview.refundedOrdersCount ?? 0) >= 3) {
    actions.push({
      id: 'returns-review',
      priority: 'medium',
      title: 'Review return patterns',
      detail: `${overview.refundedOrdersCount} refunded orders — check reasons and product quality.`,
      href: '/admin/returns',
    });
  }

  const priorityOrder = { high: 0, medium: 1, low: 2 };
  return actions
    .sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority])
    .slice(0, 8);
}

export async function buildOrderContext(orderId: string): Promise<Record<string, unknown>> {
  if (!Types.ObjectId.isValid(orderId)) throw new Error('Invalid order id');
  const order = await Order.findById(orderId)
    .populate('user', 'name email phone')
    .lean();
  if (!order) throw new Error('Order not found');

  return {
    orderNumber: order.orderNumber,
    status: order.status,
    paymentStatus: order.paymentStatus,
    paymentMethod: order.paymentMethod,
    total: order.total,
    subtotal: order.subtotal,
    discount: order.discount,
    shippingCharge: order.shippingCharge,
    createdAt: order.createdAt,
    deliveredAt: order.deliveredAt,
    returnStatus: order.returnStatus,
    returnRequest: order.returnRequest
      ? {
          reason: order.returnRequest.reason,
          note: order.returnRequest.note?.slice(0, 200),
          requestedAt: order.returnRequest.requestedAt,
        }
      : null,
    refundData: order.refundData,
    fulfillment: (order as { fulfillment?: string }).fulfillment,
    trackingNumber: order.trackingNumber,
    items: (order.items || []).map((i) => ({
      name: i.name,
      qty: i.quantity,
      price: i.price,
      sku: i.variant?.sku,
    })),
    customer:
      order.user && typeof order.user === 'object'
        ? {
            name: (order.user as { name?: string }).name,
            email: (order.user as { email?: string }).email,
          }
        : null,
    city: order.shippingAddress?.city,
    state: order.shippingAddress?.state,
  };
}

export async function buildUserContext(userId: string): Promise<Record<string, unknown>> {
  if (!Types.ObjectId.isValid(userId)) throw new Error('Invalid user id');
  const user = await User.findById(userId).select('name email role isActive createdAt adminNote').lean();
  if (!user) throw new Error('User not found');

  const orders = await Order.find({ user: user._id })
    .sort('-createdAt')
    .limit(12)
    .select('orderNumber status paymentStatus total createdAt returnStatus')
    .lean();

  const paid = orders.filter((o) => o.paymentStatus === 'paid');
  const totalSpent = paid.reduce((a, o) => a + Number(o.total || 0), 0);

  return {
    user: {
      name: user.name,
      email: user.email,
      role: user.role,
      isActive: user.isActive,
      memberSince: user.createdAt,
      adminNote: user.adminNote?.slice(0, 300),
    },
    metrics: {
      orderCount: orders.length,
      paidOrderCount: paid.length,
      totalSpent: Math.round(totalSpent * 100) / 100,
      avgOrderValue: paid.length ? Math.round((totalSpent / paid.length) * 100) / 100 : 0,
      returnRequests: orders.filter((o) => o.returnStatus && o.returnStatus !== 'none').length,
    },
    recentOrders: orders.map((o) => ({
      orderNumber: o.orderNumber,
      status: o.status,
      paymentStatus: o.paymentStatus,
      total: o.total,
      createdAt: o.createdAt,
      returnStatus: o.returnStatus,
    })),
  };
}

export async function buildReturnsContext(): Promise<Record<string, unknown>> {
  const cached = await getCache<Record<string, unknown>>(RETURNS_INSIGHTS_CACHE_KEY);
  if (cached) return { returnsInsights: cached };

  const returnMatch = { returnStatus: { $in: ['requested', 'approved', 'rejected', 'returned'] } };
  const [statusBreakdown, reasons] = await Promise.all([
    Order.aggregate<{ _id: string; count: number }>([
      { $match: returnMatch },
      { $group: { _id: '$returnStatus', count: { $sum: 1 } } },
    ]),
    Order.aggregate<{ _id: string; count: number }>([
      { $match: returnMatch },
      { $match: { 'returnRequest.reason': { $exists: true, $nin: ['', null] } } },
      { $group: { _id: '$returnRequest.reason', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 10 },
    ]),
  ]);

  const statusMap = Object.fromEntries(statusBreakdown.map((s) => [s._id, s.count]));
  return {
    returnsInsights: {
      summary: {
        totalReturnOrders: statusBreakdown.reduce((a, s) => a + s.count, 0),
        requested: statusMap.requested ?? 0,
        approved: statusMap.approved ?? 0,
        rejected: statusMap.rejected ?? 0,
      },
      topReasons: reasons,
    },
  };
}

export type ProductVariantInput = {
  size?: string;
  color?: string;
  sku?: string;
  stock?: number;
  price?: number;
};

export async function buildProductDraftContext(input: {
  name: string;
  category?: string;
  subcategory?: string;
  fabric?: string;
  price?: number;
  comparePrice?: number;
  tags?: string[];
  shortDescription?: string;
  designNotes?: string;
  variants?: ProductVariantInput[];
}): Promise<Record<string, unknown>> {
  const variantSummary = (input.variants || [])
    .filter((v) => v.size || v.color || v.sku)
    .map((v) => ({
      size: v.size || '—',
      color: v.color || '—',
      sku: v.sku || '—',
      stock: v.stock ?? 0,
    }));

  const fabric = String(input.fabric || '').trim();

  return {
    productInput: {
      ...input,
      fabric: fabric || undefined,
      fabricForDetailTable: fabric || 'not set — infer from design notes only',
      variantCount: variantSummary.length,
      variants: variantSummary,
    },
    brand: 'The House of Rani',
    storefront: 'Indian ethnic wear — sarees, suits, lehengas, gifting',
    specTableRequiredRows: ['Fabric', 'Work', 'Length', 'Blouse', 'Care'],
  };
}

export async function buildReviewDraftContext(reviewId: string): Promise<Record<string, unknown>> {
  if (!Types.ObjectId.isValid(reviewId)) throw new Error('Invalid review id');
  const review = await Review.findById(reviewId)
    .populate('product', 'name category fabric')
    .populate('user', 'name')
    .lean();
  if (!review) throw new Error('Review not found');

  return {
    rating: review.rating,
    title: review.title,
    comment: review.comment?.slice(0, 500),
    product:
      review.product && typeof review.product === 'object'
        ? {
            name: (review.product as { name?: string }).name,
            category: (review.product as { category?: string }).category,
          }
        : null,
    customerName:
      review.user && typeof review.user === 'object'
        ? (review.user as { name?: string }).name
        : 'Customer',
  };
}

export async function buildMarketingDraftContext(input: {
  adminBrief?: string;
  subjectHint?: string;
  audience?: string;
  estimatedRecipients?: number;
  ctaText?: string;
  ctaLink?: string;
  tone?: string;
}): Promise<Record<string, unknown>> {
  return {
    adminRequirements: {
      brief: input.adminBrief?.trim() || '',
      subjectHint: input.subjectHint?.trim() || '',
      audience: input.audience || 'users',
      estimatedRecipients: input.estimatedRecipients ?? 0,
      ctaText: input.ctaText?.trim() || 'Shop Now',
      ctaLink: input.ctaLink?.trim() || '/shop',
      tone: input.tone?.trim() || 'warm, festive, trustworthy',
    },
    brand: 'The House of Rani',
    brandVoice:
      'Indian ethnic wear — sarees, suits, gifting. Polite Hinglish OK. Never invent discounts unless admin wrote them.',
  };
}

/** Local smart summary — no extra Groq call, no markdown, no duplicate action cards. */
export function buildSmartActionSummary(
  ctx: Record<string, unknown>,
  rules: RuleAction[],
): { text: string; bullets: string[]; intro: string } {
  const o = (ctx.overview || {}) as Record<string, number>;
  const f = (ctx.finance || {}) as Record<string, number | { label: string; total: number }[]>;
  const fmt = (n: number) => roundInr(n).toLocaleString('en-IN');

  const urgent = rules.filter((r) => r.priority === 'high').length;
  const intro =
    urgent > 0
      ? `Aaj ${urgent} urgent priority — neeche cards se seedha action lo.`
      : rules.length > 0
        ? `${rules.length} suggested improvements — sab data store se.`
        : 'Sab theek lag raha hai — koi urgent rule trigger nahi hua.';

  const bullets: string[] = [];

  if (o.ordersToday != null && o.revenueToday != null) {
    bullets.push(`Aaj: ${o.ordersToday} orders, ₹${fmt(o.revenueToday)} revenue`);
  }
  if (o.monthRevenue != null && o.revenueGrowth != null) {
    const g = o.revenueGrowth;
    bullets.push(`MTD revenue ₹${fmt(o.monthRevenue)} (${g >= 0 ? '+' : ''}${g}% vs last month)`);
  }
  if (typeof f.monthGrossProfit === 'number' && f.monthGrossProfit > 0) {
    bullets.push(
      `MTD gross profit ~₹${fmt(f.monthGrossProfit)} (${f.monthGrossMarginPercent ?? 0}% margin on sold lines)`,
    );
  }
  if (typeof f.operatingCostsMtd === 'number' && f.operatingCostsMtd > 0) {
    bullets.push(`Operating costs MTD: ₹${fmt(f.operatingCostsMtd)} (ads, packing, shipping, misc.)`);
  }
  if (typeof f.grossProfitLifetime === 'number' && f.grossProfitLifetime > 0 && bullets.length < 5) {
    bullets.push(`Lifetime catalog gross profit: ₹${fmt(f.grossProfitLifetime)}`);
  }
  if ((o.pendingFulfillmentCount ?? 0) > 0) {
    bullets.push(`${o.pendingFulfillmentCount} orders fulfilment queue mein hain`);
  }
  if ((o.refundedOrdersCount ?? 0) >= 2) {
    bullets.push(`${o.refundedOrdersCount} refunded orders — returns page check karein`);
  }

  const trimmed = bullets.slice(0, 5);
  const text = [intro, ...trimmed.map((b) => `• ${b}`)].join('\n');
  return { text, bullets: trimmed, intro };
}

export async function buildAskStoreContext(): Promise<Record<string, unknown>> {
  const year = new Date().getFullYear();
  const [base, analytics, operatingCosts] = await Promise.all([
    buildDashboardContext(),
    getDashboardAnalyticsData(),
    getOperatingExpenseSummary({ year }).catch(() => null),
  ]);

  const snapshot = await buildRichStoreSnapshot(
    analytics as Record<string, unknown>,
    operatingCosts,
    base,
  );

  return {
    ...base,
    ...snapshot,
  };
}

/** Optional: enrich product context from DB when editing existing product */
export async function loadProductById(productId: string): Promise<Record<string, unknown> | null> {
  if (!Types.ObjectId.isValid(productId)) return null;
  const p = await Product.findById(productId)
    .select(
      'name description shortDescription price comparePrice category subcategory fabric tags seoTitle seoDescription productDetails variants',
    )
    .lean();
  if (!p) return null;
  const variants = (p.variants || []).map(
    (v: { size?: string; color?: string; sku?: string; stock?: number; price?: number }) => ({
      size: v.size || '',
      color: v.color || '',
      sku: v.sku || '',
      stock: v.stock ?? 0,
      price: v.price,
    }),
  );
  return {
    name: p.name,
    category: p.category,
    subcategory: p.subcategory,
    fabric: p.fabric,
    price: p.price,
    comparePrice: p.comparePrice,
    tags: p.tags,
    shortDescription: p.shortDescription?.slice(0, 200),
    descriptionLength: p.description?.length ?? 0,
    existingProductDetails: p.productDetails || [],
    variants,
  };
}
