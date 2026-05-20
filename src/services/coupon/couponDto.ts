import { CouponLike } from './couponBusinessRules';

const ADMIN_LIST_SELECT =
  'code description discountType discountValue minOrderAmount maxDiscountAmount usageLimit usedCount userUsageLimit startDate expiryDate isActive eligibilityType minCompletedOrders maxCompletedOrders applicableCategories archivedAt createdAt updatedAt';

const PUBLIC_VALIDATE_SELECT = 'code discountType discountValue description';

export const COUPON_ADMIN_PROJECTION = ADMIN_LIST_SELECT;
export const COUPON_PUBLIC_PROJECTION = PUBLIC_VALIDATE_SELECT;

export function toCouponValidatePayload(coupon: CouponLike) {
  return {
    code: coupon.code,
    discountType: coupon.discountType,
    discountValue: coupon.discountValue,
    description: coupon.description,
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
