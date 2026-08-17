import OfferInteractionEvent from '../models/OfferInteractionEvent';
import Order from '../models/Order';
import Promotion from '../models/Promotion';
import Coupon from '../models/Coupon';
import {
  PAYMENT_STATUS_GROSS,
  couponDiscountPipeline,
  promotionDiscountPipeline,
  saleDiscountPipeline,
  COUPON_DISCOUNT_EXPR,
  PROMOTION_DISCOUNT_EXPR,
} from './orderFinanceAggregations';
import { istDateString } from './storeVisitService';

function visitDateRange(bounds: { start: Date | null; end: Date }) {
  const range: Record<string, string> = { $lte: istDateString(bounds.end) };
  if (bounds.start) range.$gte = istDateString(bounds.start);
  return range;
}

function orderCreatedMatch(bounds: { start: Date | null; end: Date }) {
  const range: Record<string, Date> = { $lte: bounds.end };
  if (bounds.start) range.$gte = bounds.start;
  return { createdAt: range };
}

export type OfferAttributionSummary = {
  sales: { discountTotal: number; ordersCount: number };
  promotions: { discountTotal: number; ordersCount: number; top: { id: string; name: string; discountTotal: number; ordersCount: number }[] };
  coupons: { discountTotal: number; ordersCount: number; top: { id: string; code: string; discountTotal: number; ordersCount: number }[] };
  popup: {
    impressions: number;
    dismisses: number;
    ctaClicks: number;
    couponCopies: number;
    byKind: { kind: string; impressions: number; ctaClicks: number }[];
    ordersAfterPopup: number;
    revenueAfterPopup: number;
  };
};

export async function getOfferAttributionSummary(bounds: {
  start: Date | null;
  end: Date;
}): Promise<OfferAttributionSummary> {
  const orderMatch = orderCreatedMatch(bounds);
  const visitMatch = { visitDate: visitDateRange(bounds) };

  const [
    saleAgg,
    promoAgg,
    couponAgg,
    topPromotions,
    topCoupons,
    popupCounts,
    popupByKind,
    popupSessionKeys,
  ] = await Promise.all([
    Order.aggregate(saleDiscountPipeline(orderMatch)),
    Order.aggregate(promotionDiscountPipeline(orderMatch)),
    Order.aggregate(couponDiscountPipeline(orderMatch)),
    Order.aggregate([
      { $match: { ...PAYMENT_STATUS_GROSS, ...orderMatch, promotion: { $exists: true, $ne: null } } },
      { $addFields: { effectivePromo: PROMOTION_DISCOUNT_EXPR } },
      { $match: { effectivePromo: { $gt: 0 } } },
      {
        $group: {
          _id: '$promotion',
          discountTotal: { $sum: '$effectivePromo' },
          ordersCount: { $sum: 1 },
        },
      },
      { $sort: { discountTotal: -1 } },
      { $limit: 8 },
    ]),
    Order.aggregate([
      { $match: { ...PAYMENT_STATUS_GROSS, ...orderMatch, coupon: { $exists: true, $ne: null } } },
      { $addFields: { effectiveCoupon: COUPON_DISCOUNT_EXPR } },
      { $match: { effectiveCoupon: { $gt: 0 } } },
      {
        $group: {
          _id: '$coupon',
          discountTotal: { $sum: '$effectiveCoupon' },
          ordersCount: { $sum: 1 },
        },
      },
      { $sort: { discountTotal: -1 } },
      { $limit: 8 },
    ]),
    OfferInteractionEvent.aggregate([
      { $match: visitMatch },
      {
        $group: {
          _id: '$eventType',
          count: { $sum: 1 },
        },
      },
    ]),
    OfferInteractionEvent.aggregate([
      { $match: { ...visitMatch, eventType: { $in: ['popup_impression', 'popup_cta_click'] } } },
      {
        $group: {
          _id: { kind: '$offerKind', eventType: '$eventType' },
          count: { $sum: 1 },
        },
      },
    ]),
    OfferInteractionEvent.distinct('sessionKey', {
      ...visitMatch,
      eventType: 'popup_impression',
    }),
  ]);

  const promoIds = topPromotions.map((r) => r._id).filter(Boolean);
  const couponIds = topCoupons.map((r) => r._id).filter(Boolean);

  const [promoDocs, couponDocs] = await Promise.all([
    promoIds.length ?
      Promotion.find({ _id: { $in: promoIds } })
        .select('name displayTitle')
        .lean()
    : [],
    couponIds.length ?
      Coupon.find({ _id: { $in: couponIds } })
        .select('code')
        .lean()
    : [],
  ]);

  const promoNameMap = new Map(
    promoDocs.map((p) => [
      String(p._id),
      String((p as { displayTitle?: string; name?: string }).displayTitle || p.name || 'Auto offer'),
    ]),
  );
  const couponCodeMap = new Map(couponDocs.map((c) => [String(c._id), String(c.code || '')]));

  let ordersAfterPopup = 0;
  let revenueAfterPopup = 0;
  if (popupSessionKeys.length > 0) {
    const popupOrderAgg = await Order.aggregate([
      {
        $match: {
          ...PAYMENT_STATUS_GROSS,
          ...orderMatch,
          shopSessionKey: { $in: popupSessionKeys },
        },
      },
      {
        $group: {
          _id: null,
          count: { $sum: 1 },
          revenue: { $sum: '$total' },
        },
      },
    ]);
    ordersAfterPopup = popupOrderAgg[0]?.count ?? 0;
    revenueAfterPopup = Math.round((popupOrderAgg[0]?.revenue ?? 0) * 100) / 100;
  }

  const popupCountMap = new Map(popupCounts.map((r) => [String(r._id), r.count as number]));

  // CTA clicks tracked separately
  const ctaAgg = await OfferInteractionEvent.countDocuments({
    ...visitMatch,
    eventType: 'popup_cta_click',
  });

  const kindMap = new Map<string, { impressions: number; ctaClicks: number }>();
  for (const row of popupByKind as { _id: { kind: string; eventType: string }; count: number }[]) {
    const kind = row._id.kind;
    const existing = kindMap.get(kind) ?? { impressions: 0, ctaClicks: 0 };
    if (row._id.eventType === 'popup_impression') existing.impressions += row.count;
    if (row._id.eventType === 'popup_cta_click') existing.ctaClicks += row.count;
    kindMap.set(kind, existing);
  }

  return {
    sales: {
      discountTotal: Math.round((saleAgg[0]?.totalDiscount ?? 0) * 100) / 100,
      ordersCount: saleAgg[0]?.count ?? 0,
    },
    promotions: {
      discountTotal: Math.round((promoAgg[0]?.totalDiscount ?? 0) * 100) / 100,
      ordersCount: promoAgg[0]?.count ?? 0,
      top: topPromotions.map((row) => ({
        id: String(row._id),
        name: promoNameMap.get(String(row._id)) || 'Auto offer',
        discountTotal: Math.round((row.discountTotal ?? 0) * 100) / 100,
        ordersCount: row.ordersCount ?? 0,
      })),
    },
    coupons: {
      discountTotal: Math.round((couponAgg[0]?.totalDiscount ?? 0) * 100) / 100,
      ordersCount: couponAgg[0]?.count ?? 0,
      top: topCoupons.map((row) => ({
        id: String(row._id),
        code: couponCodeMap.get(String(row._id)) || '—',
        discountTotal: Math.round((row.discountTotal ?? 0) * 100) / 100,
        ordersCount: row.ordersCount ?? 0,
      })),
    },
    popup: {
      impressions: popupCountMap.get('popup_impression') ?? 0,
      dismisses: popupCountMap.get('popup_dismiss') ?? 0,
      ctaClicks: ctaAgg,
      couponCopies: popupCountMap.get('coupon_copy') ?? 0,
      byKind: Array.from(kindMap.entries()).map(([kind, stats]) => ({
        kind,
        impressions: stats.impressions,
        ctaClicks: stats.ctaClicks,
      })),
      ordersAfterPopup,
      revenueAfterPopup,
    },
  };
}
