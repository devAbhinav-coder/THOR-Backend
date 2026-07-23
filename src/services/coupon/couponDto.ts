import { CouponLike } from './couponBusinessRules';

const ADMIN_LIST_SELECT =
  'code description displayTitle imageUrl imagePublicId showOnStorefront discountType discountValue minOrderAmount maxDiscountAmount usageLimit usedCount userUsageLimit startDate expiryDate isActive eligibilityType minCompletedOrders maxCompletedOrders scopeType applicableCategories applicableCategoryIds applicableSubcategoryIds applicableProductIds archivedAt createdAt updatedAt';

const PUBLIC_VALIDATE_SELECT =
  'code discountType discountValue description displayTitle imageUrl scopeType';

const PUBLIC_STOREFRONT_SELECT =
  'code description displayTitle imageUrl discountType discountValue minOrderAmount maxDiscountAmount startDate expiryDate scopeType applicableCategoryIds applicableSubcategoryIds applicableProductIds';

export const COUPON_ADMIN_PROJECTION = ADMIN_LIST_SELECT;
export const COUPON_PUBLIC_PROJECTION = PUBLIC_VALIDATE_SELECT;
export const COUPON_STOREFRONT_PROJECTION = PUBLIC_STOREFRONT_SELECT;

export function toCouponValidatePayload(coupon: CouponLike) {
  return {
    code: coupon.code,
    discountType: coupon.discountType,
    discountValue: coupon.discountValue,
    description: coupon.description,
    displayTitle: coupon.displayTitle,
    imageUrl: coupon.imageUrl,
    scopeType: coupon.scopeType || 'all',
  };
}

export function toCouponStorefrontDto(coupon: CouponLike) {
  const scope = coupon.scopeType || 'all';
  return {
    code: coupon.code,
    description: coupon.description,
    // Keep description separate so storefront popup can show title + body copy
    displayTitle: coupon.displayTitle || coupon.code,
    imageUrl: coupon.imageUrl || null,
    discountType: coupon.discountType,
    discountValue: coupon.discountValue,
    minOrderAmount: coupon.minOrderAmount ?? 0,
    maxDiscountAmount: coupon.maxDiscountAmount ?? null,
    startDate: coupon.startDate,
    expiryDate: coupon.expiryDate,
    scopeType: scope,
  };
}

export function toCouponAdminDto(doc: Record<string, unknown>) {
  const { usedBy, __v, ...rest } = doc;
  void usedBy;
  void __v;
  return rest;
}

export function toCouponAdminListDto(docs: Record<string, unknown>[]) {
  return docs.map(toCouponAdminDto);
}
