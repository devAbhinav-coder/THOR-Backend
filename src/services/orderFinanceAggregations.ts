/** Shared order-level $addFields for coupon discount and fee totals (admin revenue). */

export const PAYMENT_STATUS_GROSS = { paymentStatus: { $in: ['paid', 'refunded'] as const } };

/** Stored discount, or implied from totals when coupon is set but discount was not persisted. */
export const EFFECTIVE_DISCOUNT_EXPR = {
  $let: {
    vars: {
      stored: { $ifNull: ['$discount', 0] },
      charges: {
        $add: [
          { $ifNull: ['$shippingCharge', 0] },
          { $ifNull: ['$codFee', 0] },
          { $ifNull: ['$tax', 0] },
        ],
      },
    },
    in: {
      $cond: [
        { $gt: ['$$stored', 0] },
        '$$stored',
        {
          $cond: [
            { $ne: [{ $ifNull: ['$coupon', null] }, null] },
            {
              $max: [
                0,
                {
                  $round: [
                    {
                      $subtract: [
                        { $ifNull: ['$subtotal', 0] },
                        { $subtract: [{ $ifNull: ['$total', 0] }, '$$charges'] },
                      ],
                    },
                    2,
                  ],
                },
              ],
            },
            0,
          ],
        },
      ],
    },
  },
};

export const HAS_COUPON_OR_DISCOUNT_MATCH = {
  $or: [
    { discount: { $gt: 0 } },
    { coupon: { $exists: true, $ne: null } },
  ],
};

export function couponDiscountPipeline(match: Record<string, unknown> = {}) {
  return [
    { $match: { ...PAYMENT_STATUS_GROSS, ...match } },
    { $addFields: { effectiveDiscount: EFFECTIVE_DISCOUNT_EXPR } },
    { $match: { $or: [{ effectiveDiscount: { $gt: 0 } }, { coupon: { $exists: true, $ne: null } }] } },
    {
      $group: {
        _id: null,
        totalDiscount: { $sum: '$effectiveDiscount' },
        count: { $sum: 1 },
      },
    },
  ];
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
