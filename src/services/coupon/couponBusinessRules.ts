import mongoose from 'mongoose';

export const COUPON_QUERY_MAX_MS = Number(process.env.COUPON_QUERY_MAX_MS || 5000);

export type CouponLike = {
  _id?: mongoose.Types.ObjectId | string;
  code: string;
  description?: string;
  discountType: 'percentage' | 'flat';
  discountValue: number;
  minOrderAmount?: number;
  maxDiscountAmount?: number;
  usageLimit?: number;
  usedCount: number;
  userUsageLimit: number;
  usedBy?: { user: mongoose.Types.ObjectId | string; usedAt?: Date }[];
  startDate: Date;
  expiryDate: Date;
  isActive: boolean;
  eligibilityType?: 'all' | 'first_order' | 'returning';
  minCompletedOrders?: number;
  maxCompletedOrders?: number;
  deletedAt?: Date | null;
  archivedAt?: Date | null;
};

export function normalizeCouponCode(raw: string): string {
  return raw.trim().toUpperCase();
}

/** Treat expiry as inclusive through end of the stored calendar day (UTC). */
export function isWithinValidityWindow(startDate: Date, expiryDate: Date, now = new Date()): boolean {
  const start = new Date(startDate);
  const end = new Date(expiryDate);
  if (end.getUTCHours() === 0 && end.getUTCMinutes() === 0 && end.getUTCSeconds() === 0) {
    end.setUTCHours(23, 59, 59, 999);
  }
  return now >= start && now <= end;
}

export function countUserCouponUsage(
  usedBy: CouponLike['usedBy'],
  userId: string
): number {
  if (!usedBy?.length) return 0;
  return usedBy.filter((u) => String(u.user) === userId).length;
}

export function evaluateCouponValidity(
  coupon: CouponLike,
  userId: string,
  orderAmount: number,
  opts?: { completedOrders?: number; now?: Date }
): { valid: boolean; message?: string } {
  const now = opts?.now ?? new Date();
  const completedOrders = opts?.completedOrders ?? 0;

  if (coupon.deletedAt) return { valid: false, message: 'This coupon is no longer available' };
  if (!coupon.isActive) return { valid: false, message: 'This coupon is inactive' };
  if (now < coupon.startDate) return { valid: false, message: 'This coupon is not yet active' };
  if (!isWithinValidityWindow(coupon.startDate, coupon.expiryDate, now)) {
    return { valid: false, message: 'This coupon has expired' };
  }
  if (coupon.usageLimit != null && coupon.usedCount >= coupon.usageLimit) {
    return { valid: false, message: 'This coupon has reached its usage limit' };
  }
  if (coupon.minOrderAmount && orderAmount < coupon.minOrderAmount) {
    return { valid: false, message: `Minimum order amount of ₹${coupon.minOrderAmount} required` };
  }

  const userUsage = countUserCouponUsage(coupon.usedBy, userId);
  if (userUsage >= coupon.userUsageLimit) {
    return { valid: false, message: 'You have already used this coupon' };
  }

  const eligibility = coupon.eligibilityType ?? 'all';
  if (eligibility === 'first_order' && completedOrders > 0) {
    return { valid: false, message: 'This coupon is valid for first-time customers only' };
  }
  if (eligibility === 'returning' && completedOrders === 0) {
    return { valid: false, message: 'This coupon is valid for returning customers only' };
  }
  if (coupon.minCompletedOrders && completedOrders < coupon.minCompletedOrders) {
    return {
      valid: false,
      message: `You need at least ${coupon.minCompletedOrders} completed orders for this coupon`,
    };
  }
  if (coupon.maxCompletedOrders !== undefined && completedOrders > coupon.maxCompletedOrders) {
    return { valid: false, message: 'You are not eligible for this coupon' };
  }

  return { valid: true };
}

export function calculateCouponDiscount(coupon: CouponLike, orderAmount: number): number {
  let discount = 0;
  if (coupon.discountType === 'percentage') {
    discount = (orderAmount * coupon.discountValue) / 100;
    if (coupon.maxDiscountAmount) {
      discount = Math.min(discount, coupon.maxDiscountAmount);
    }
  } else {
    discount = coupon.discountValue;
  }
  return Math.min(discount, orderAmount);
}

export function assertCouponBusinessRules(input: {
  discountType: 'percentage' | 'flat';
  discountValue: number;
  startDate: Date;
  expiryDate: Date;
  usageLimit?: number;
  userUsageLimit?: number;
  minCompletedOrders?: number;
  maxCompletedOrders?: number;
}): void {
  if (input.discountValue < 0) throw new Error('Discount value cannot be negative');
  if (input.discountType === 'percentage' && input.discountValue > 100) {
    throw new Error('Percentage discount cannot exceed 100');
  }
  if (input.expiryDate <= input.startDate) {
    throw new Error('Expiry date must be after start date');
  }
  if (input.usageLimit !== undefined && input.usageLimit < 1) {
    throw new Error('Usage limit must be at least 1');
  }
  if (input.userUsageLimit !== undefined && input.userUsageLimit < 1) {
    throw new Error('Per-user usage limit must be at least 1');
  }
  if (
    input.maxCompletedOrders !== undefined &&
    input.minCompletedOrders !== undefined &&
    input.maxCompletedOrders < input.minCompletedOrders
  ) {
    throw new Error('maxCompletedOrders cannot be less than minCompletedOrders');
  }
}

/** End-of-day UTC normalization for admin-entered expiry dates. */
export function normalizeExpiryDate(date: Date): Date {
  const d = new Date(date);
  if (d.getUTCHours() === 0 && d.getUTCMinutes() === 0 && d.getUTCSeconds() === 0) {
    d.setUTCHours(23, 59, 59, 999);
  }
  return d;
}
