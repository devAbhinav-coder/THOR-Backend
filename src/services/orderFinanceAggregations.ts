/** Shared order-level $addFields for discount breakdown (admin revenue). */

export const PAYMENT_STATUS_GROSS = { paymentStatus: { $in: ['paid', 'refunded'] as const } };

export const COUPON_DISCOUNT_EXPR = {
  $let: {
    vars: {
      explicit: { $ifNull: ['$couponDiscount', 0] },
      promo: { $ifNull: ['$promotionDiscount', 0] },
      stored: { $ifNull: ['$discount', 0] },
    },
    in: {
      $cond: [
        { $gt: ['$$explicit', 0] },
        '$$explicit',
        {
          $cond: [
            { $ne: [{ $ifNull: ['$coupon', null] }, null] },
            { $max: [0, { $subtract: ['$$stored', '$$promo'] }] },
            0,
          ],
        },
      ],
    },
  },
};

export const PROMOTION_DISCOUNT_EXPR = {
  $let: {
    vars: {
      explicit: { $ifNull: ['$promotionDiscount', 0] },
      coupon: { $ifNull: ['$couponDiscount', 0] },
      stored: { $ifNull: ['$discount', 0] },
    },
    in: {
      $cond: [
        { $gt: ['$$explicit', 0] },
        '$$explicit',
        {
          $cond: [
            { $ne: [{ $ifNull: ['$promotion', null] }, null] },
            { $max: [0, { $subtract: ['$$stored', '$$coupon'] }] },
            0,
          ],
        },
      ],
    },
  },
};

export const SALE_DISCOUNT_EXPR = { $ifNull: ['$saleDiscount', 0] };

/** @deprecated Use COUPON_DISCOUNT_EXPR — kept for legacy implied discount fallback. */
export const EFFECTIVE_DISCOUNT_EXPR = COUPON_DISCOUNT_EXPR;

export const HAS_COUPON_OR_DISCOUNT_MATCH = {
  $or: [
    { couponDiscount: { $gt: 0 } },
    { discount: { $gt: 0 } },
    { coupon: { $exists: true, $ne: null } },
  ],
};

function discountPipeline(
  match: Record<string, unknown>,
  discountExpr: Record<string, unknown>,
  hasDiscountMatch: Record<string, unknown>,
) {
  return [
    { $match: { ...PAYMENT_STATUS_GROSS, ...match } },
    { $addFields: { effectiveAmount: discountExpr } },
    { $match: hasDiscountMatch },
    {
      $group: {
        _id: null,
        totalDiscount: { $sum: '$effectiveAmount' },
        count: { $sum: { $cond: [{ $gt: ['$effectiveAmount', 0] }, 1, 0] } },
      },
    },
  ];
}

export function couponDiscountPipeline(match: Record<string, unknown> = {}) {
  return discountPipeline(
    match,
    COUPON_DISCOUNT_EXPR,
    {
      $or: [
        { effectiveAmount: { $gt: 0 } },
        { coupon: { $exists: true, $ne: null } },
      ],
    },
  );
}

export function promotionDiscountPipeline(match: Record<string, unknown> = {}) {
  return discountPipeline(
    match,
    PROMOTION_DISCOUNT_EXPR,
    {
      $or: [
        { effectiveAmount: { $gt: 0 } },
        { promotion: { $exists: true, $ne: null } },
      ],
    },
  );
}

export function saleDiscountPipeline(match: Record<string, unknown> = {}) {
  return discountPipeline(match, SALE_DISCOUNT_EXPR, { effectiveAmount: { $gt: 0 } });
}

export function orderFeesPipeline(match: Record<string, unknown> = {}) {
  return [
    { $match: { ...PAYMENT_STATUS_GROSS, ...match } },
    {
      $group: {
        _id: null,
        shipping: { $sum: { $ifNull: ['$shippingCharge', 0] } },
        cod: { $sum: { $ifNull: ['$codFee', 0] } },
      },
    },
  ];
}

export function taxCollectedPipeline(match: Record<string, unknown> = {}) {
  return [
    { $match: { paymentStatus: 'paid' as const, ...match } },
    { $group: { _id: null, total: { $sum: { $ifNull: ['$tax', 0] } } } },
  ];
}

export function nonRefundableFeesPipeline(match: Record<string, unknown> = {}) {
  return [
    { $match: { 'refundData.nonRefundableFees': { $gt: 0 }, ...match } },
    { $group: { _id: null, total: { $sum: '$refundData.nonRefundableFees' } } },
  ];
}
