import Coupon from '../../models/Coupon';
import {
  buildCouponProgressHint,
  COUPON_QUERY_MAX_MS,
  couponDisplayLabel,
  couponMatchesProduct,
  CouponLike,
  CouponLineScope,
  evaluateCouponValidity,
  isWithinValidityWindow,
} from './couponBusinessRules';
import {
  getCachedActiveCoupons,
  setCachedActiveCoupons,
} from './couponCacheService';

const MATCHING_PROJECTION =
  'code description displayTitle discountType discountValue minOrderAmount maxDiscountAmount usageLimit usedCount userUsageLimit eligibilityType minCompletedOrders maxCompletedOrders startDate expiryDate isActive scopeType applicableCategories applicableCategoryIds applicableSubcategoryIds applicableSubcategoryNames applicableProductIds showOnStorefront';

const ACTIVE_COUPON_DB_FILTER = {
  isActive: true,
  deletedAt: null,
  archivedAt: null,
};

export type ProductCouponDto = {
  code: string;
  displayTitle: string;
  label: string;
  savingsLabel: string;
  description?: string;
};

export type ProductNearEligibleCouponDto = ProductCouponDto & {
  hintMessage: string;
};

function couponSavingsLabel(coupon: CouponLike): string {
  if (coupon.discountType === 'percentage') {
    return `${coupon.discountValue}% off`;
  }
  if (coupon.discountType === 'fixed') {
    return `At ₹${coupon.discountValue}`;
  }
  return `₹${coupon.discountValue} off`;
}

function mapProductCoupon(c: CouponLike): ProductCouponDto {
  return {
    code: c.code,
    displayTitle: c.displayTitle?.trim() || c.code,
    label: couponDisplayLabel(c),
    savingsLabel: couponSavingsLabel(c),
    description: c.description,
  };
}

function productCouponLine(
  product: {
    _id: string;
    categoryId?: string | null;
    subcategoryId?: string | null;
    category?: string | null;
    subcategory?: string | null;
  },
  orderAmount: number,
  quantity = 1,
): CouponLineScope {
  const qty = Math.max(1, quantity);
  const unitPrice = orderAmount / qty;
  return {
    productId: String(product._id),
    categoryId: product.categoryId ? String(product.categoryId) : null,
    subcategoryId: product.subcategoryId ? String(product.subcategoryId) : null,
    categoryName: product.category || null,
    subcategoryName: product.subcategory || null,
    lineTotal: orderAmount,
    quantity: qty,
    unitPrice,
  };
}

export async function getStorefrontCouponsForMatching(
  now = new Date(),
): Promise<CouponLike[]> {
  const cached = await getCachedActiveCoupons();
  if (cached) {
    return cached.filter(
      (c) =>
        c.showOnStorefront !== false &&
        isWithinValidityWindow(c.startDate, c.expiryDate, now),
    );
  }

  const coupons = await Coupon.find({
    ...ACTIVE_COUPON_DB_FILTER,
    showOnStorefront: { $ne: false },
    startDate: { $lte: now },
    expiryDate: { $gte: now },
  })
    .select(MATCHING_PROJECTION)
    .sort('-createdAt')
    .limit(48)
    .maxTimeMS(COUPON_QUERY_MAX_MS)
    .lean<CouponLike[]>();

  const active = coupons.filter((c) =>
    isWithinValidityWindow(c.startDate, c.expiryDate, now),
  );
  await setCachedActiveCoupons(active);
  return active;
}

export function getCouponsForProduct(
  coupons: CouponLike[],
  product: {
    _id: string;
    categoryId?: string | null;
    subcategoryId?: string | null;
    category?: string | null;
    subcategory?: string | null;
  },
  orderAmount: number,
  opts?: { userId?: string; completedOrders?: number; quantity?: number },
): ProductCouponDto[] {
  const amount = Math.max(0, orderAmount);
  const line = productCouponLine(product, amount, opts?.quantity ?? 1);
  const userId = opts?.userId || '';
  const completedOrders = opts?.completedOrders ?? 0;

  return coupons
    .filter((c) => couponMatchesProduct(c, product))
    .filter((c) =>
      evaluateCouponValidity(c, userId, amount, {
        completedOrders,
        lines: [line],
      }).valid,
    )
    .map(mapProductCoupon);
}

export function getNearEligibleCouponsForProduct(
  coupons: CouponLike[],
  product: {
    _id: string;
    categoryId?: string | null;
    subcategoryId?: string | null;
    category?: string | null;
    subcategory?: string | null;
  },
  orderAmount: number,
  opts?: { userId?: string; completedOrders?: number; quantity?: number },
): ProductNearEligibleCouponDto[] {
  const amount = Math.max(0, orderAmount);
  const line = productCouponLine(product, amount, opts?.quantity ?? 1);
  const userId = opts?.userId || '';
  const completedOrders = opts?.completedOrders ?? 0;
  const eligibleCodes = new Set(
    getCouponsForProduct(coupons, product, orderAmount, opts).map((c) => c.code),
  );

  const nearEligible: ProductNearEligibleCouponDto[] = [];

  for (const coupon of coupons) {
    if (!couponMatchesProduct(coupon, product) || eligibleCodes.has(coupon.code)) {
      continue;
    }
    const validity = evaluateCouponValidity(coupon, userId, amount, {
      completedOrders,
      lines: [line],
    });
    if (validity.valid) continue;
    const hint = buildCouponProgressHint(coupon, validity);
    if (!hint) continue;
    nearEligible.push({
      ...mapProductCoupon(coupon),
      hintMessage: hint.message,
    });
  }

  return nearEligible;
}

export function getProductCouponOffers(
  coupons: CouponLike[],
  product: {
    _id: string;
    categoryId?: string | null;
    subcategoryId?: string | null;
    category?: string | null;
    subcategory?: string | null;
  },
  orderAmount: number,
  opts?: { userId?: string; completedOrders?: number; quantity?: number },
): {
  activeCoupons: ProductCouponDto[];
  nearEligibleCoupons: ProductNearEligibleCouponDto[];
} {
  return {
    activeCoupons: getCouponsForProduct(coupons, product, orderAmount, opts),
    nearEligibleCoupons: getNearEligibleCouponsForProduct(
      coupons,
      product,
      orderAmount,
      opts,
    ),
  };
}
