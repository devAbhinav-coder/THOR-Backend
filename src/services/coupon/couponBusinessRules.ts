import mongoose from 'mongoose';
import { createHash } from 'node:crypto';

export const COUPON_QUERY_MAX_MS = Number(process.env.COUPON_QUERY_MAX_MS || 5000);

export type PromoScopeType = 'all' | 'categories' | 'subcategories' | 'products';

export type CouponLike = {
  _id?: mongoose.Types.ObjectId | string;
  code: string;
  description?: string;
  displayTitle?: string;
  imageUrl?: string;
  imagePublicId?: string;
  showOnStorefront?: boolean;
  discountType: 'percentage' | 'flat' | 'fixed';
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
  scopeType?: PromoScopeType;
  applicableCategories?: string[];
  /** Runtime-only: enriched subcategory display names for ID-scoped coupons. */
  applicableSubcategoryNames?: string[];
  applicableCategoryIds?: (mongoose.Types.ObjectId | string)[];
  applicableSubcategoryIds?: (mongoose.Types.ObjectId | string)[];
  applicableProductIds?: (mongoose.Types.ObjectId | string)[];
};

/** Cart/checkout line used for scope matching. */
export type CouponLineScope = {
  productId: string;
  categoryId?: string | null;
  subcategoryId?: string | null;
  /** Legacy string fields — used when FK ids were missing at write time. */
  categoryName?: string | null;
  subcategoryName?: string | null;
  /** Unit selling price for this line. */
  unitPrice?: number;
  /** Quantity in cart (defaults to 1 when omitted). */
  quantity?: number;
  lineTotal: number;
};

export function linesScopeFingerprint(lines?: CouponLineScope[]): string | undefined {
  if (!lines?.length) return undefined;
  const parts = lines
    .map((l) => {
      const qty = Math.max(1, Number(l.quantity) || 1);
      const unit =
        l.unitPrice != null && Number.isFinite(Number(l.unitPrice))
          ? Number(l.unitPrice)
          : Math.round((Number(l.lineTotal) / qty) * 100) / 100;
      return `${l.productId}:${l.categoryId || ''}:${l.subcategoryId || ''}:${qty}:${Math.round(unit * 100)}`;
    })
    .sort();
  return `L${lines.length}h${createHash('sha1').update(parts.join('|')).digest('hex').slice(0, 16)}`;
}

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

function idSet(ids?: (mongoose.Types.ObjectId | string)[]): Set<string> {
  return new Set((ids || []).map((id) => String(id)).filter(Boolean));
}

export function lineMatchesCouponScope(
  coupon: CouponLike,
  line: CouponLineScope
): boolean {
  const scope = coupon.scopeType || 'all';
  if (scope === 'all') return true;
  if (scope === 'products') {
    return idSet(coupon.applicableProductIds).has(String(line.productId));
  }
  if (scope === 'categories') {
    if (line.categoryId && idSet(coupon.applicableCategoryIds).has(String(line.categoryId))) {
      return true;
    }
    const names = new Set(
      (coupon.applicableCategories || []).map((n) => String(n).trim().toLowerCase()).filter(Boolean),
    );
    if (line.categoryName && names.has(String(line.categoryName).trim().toLowerCase())) {
      return true;
    }
    // Leaf collections are often SubCategories (e.g. Chanderi) while admin scopes a Category
    // with the same display name — treat name match on subcategory as eligible.
    if (line.subcategoryName && names.has(String(line.subcategoryName).trim().toLowerCase())) {
      return true;
    }
    return false;
  }
  if (scope === 'subcategories') {
    if (
      line.subcategoryId &&
      idSet(coupon.applicableSubcategoryIds).has(String(line.subcategoryId))
    ) {
      return true;
    }
    const names = new Set(
      (coupon.applicableSubcategoryNames || [])
        .map((n) => String(n).trim().toLowerCase())
        .filter(Boolean),
    );
    if (line.subcategoryName && names.has(String(line.subcategoryName).trim().toLowerCase())) {
      return true;
    }
    return false;
  }
  return true;
}

export function computeEligibleSubtotal(
  coupon: CouponLike,
  lines: CouponLineScope[]
): { eligibleSubtotal: number; matchedLineCount: number } {
  const scope = coupon.scopeType || 'all';
  if (scope === 'all' || lines.length === 0) {
    const total = lines.reduce((sum, l) => sum + Math.max(0, l.lineTotal), 0);
    return { eligibleSubtotal: total, matchedLineCount: lines.length };
  }
  let eligibleSubtotal = 0;
  let matchedLineCount = 0;
  for (const line of lines) {
    if (lineMatchesCouponScope(coupon, line)) {
      eligibleSubtotal += Math.max(0, line.lineTotal);
      matchedLineCount += 1;
    }
  }
  return { eligibleSubtotal, matchedLineCount };
}

/**
 * Amount used for min-order check and discount math.
 * Scoped coupons use eligible lines only; `all` uses full order amount
 * (or eligible total when lines are provided).
 */
export function resolveDiscountBaseAmount(
  coupon: CouponLike,
  orderAmount: number,
  lines?: CouponLineScope[]
): { amount: number; matchedLineCount: number; message?: string } {
  const scope = coupon.scopeType || 'all';
  if (!lines || lines.length === 0) {
    if (scope !== 'all') {
      return {
        amount: 0,
        matchedLineCount: 0,
        message: 'This coupon does not apply to any items in your cart',
      };
    }
    return { amount: orderAmount, matchedLineCount: 0 };
  }
  const { eligibleSubtotal, matchedLineCount } = computeEligibleSubtotal(coupon, lines);
  if (scope !== 'all' && matchedLineCount === 0) {
    return {
      amount: 0,
      matchedLineCount: 0,
      message: 'This coupon does not apply to any items in your cart',
    };
  }
  return { amount: eligibleSubtotal, matchedLineCount };
}

export function evaluateCouponValidity(
  coupon: CouponLike,
  userId: string,
  orderAmount: number,
  opts?: {
    completedOrders?: number;
    now?: Date;
    lines?: CouponLineScope[];
  }
): { valid: boolean; message?: string; eligibleAmount?: number } {
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

  const base = resolveDiscountBaseAmount(coupon, orderAmount, opts?.lines);
  if (base.message) return { valid: false, message: base.message, eligibleAmount: 0 };

  if (coupon.minOrderAmount && base.amount < coupon.minOrderAmount) {
    return {
      valid: false,
      message: `Minimum order amount of ₹${coupon.minOrderAmount} required`,
      eligibleAmount: base.amount,
    };
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

  // Direct price / flat / % must actually save money on the eligible base.
  // Otherwise carts show "coupon applied · Off ₹0" and Direct Price looks broken.
  const discount = calculateCouponDiscount(coupon, base.amount, opts?.lines);
  if (discount <= 0) {
    if (coupon.discountType === 'fixed') {
      const scoped = (coupon.scopeType || 'all') !== 'all';
      return {
        valid: false,
        message: scoped
          ? `Eligible items must be priced above ₹${coupon.discountValue} for this offer`
          : `Eligible items must total more than ₹${coupon.discountValue} for this offer`,
        eligibleAmount: base.amount,
      };
    }
    return {
      valid: false,
      message: 'This coupon does not reduce the price of items in your cart',
      eligibleAmount: base.amount,
    };
  }

  return { valid: true, eligibleAmount: base.amount };
}

/**
 * Compute coupon discount.
 * - percentage / flat: on `orderAmount` (eligible base)
 * - fixed + scope all: whole eligible base pays `discountValue`
 * - fixed + category/subcategory/product: each matching unit pays `discountValue`
 *   (same as sale Direct Price — 5 products ≠ cart at ₹1150, each is ₹1150)
 */
export function calculateCouponDiscount(
  coupon: CouponLike,
  orderAmount: number,
  lines?: CouponLineScope[]
): number {
  let discount = 0;
  if (coupon.discountType === 'percentage') {
    discount = (orderAmount * coupon.discountValue) / 100;
    if (coupon.maxDiscountAmount) {
      discount = Math.min(discount, coupon.maxDiscountAmount);
    }
  } else if (coupon.discountType === 'fixed') {
    const scope = coupon.scopeType || 'all';
    const usePerUnit =
      scope !== 'all' && Array.isArray(lines) && lines.length > 0;

    if (usePerUnit) {
      for (const line of lines) {
        if (!lineMatchesCouponScope(coupon, line)) continue;
        const qty = Math.max(1, Math.floor(Number(line.quantity) || 1));
        const unitPrice =
          line.unitPrice != null && Number.isFinite(Number(line.unitPrice))
            ? Math.max(0, Number(line.unitPrice))
            : Math.max(0, Number(line.lineTotal) / qty);
        discount += Math.max(0, unitPrice - coupon.discountValue) * qty;
      }
    } else {
      // Eligible cart (or full order when scope=all) pays this exact amount
      discount = Math.max(0, orderAmount - coupon.discountValue);
    }
  } else {
    discount = coupon.discountValue;
  }
  return Math.min(discount, Math.max(0, orderAmount));
}

export function assertCouponBusinessRules(input: {
  discountType: 'percentage' | 'flat' | 'fixed';
  discountValue: number;
  startDate: Date;
  expiryDate: Date;
  usageLimit?: number;
  userUsageLimit?: number;
  minCompletedOrders?: number;
  maxCompletedOrders?: number;
  scopeType?: PromoScopeType;
  applicableCategoryIds?: unknown[];
  applicableSubcategoryIds?: unknown[];
  applicableProductIds?: unknown[];
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
  const scope = input.scopeType || 'all';
  if (scope === 'categories' && !(input.applicableCategoryIds?.length)) {
    throw new Error('Select at least one category for this coupon');
  }
  if (scope === 'subcategories' && !(input.applicableSubcategoryIds?.length)) {
    throw new Error('Select at least one subcategory for this coupon');
  }
  if (scope === 'products' && !(input.applicableProductIds?.length)) {
    throw new Error('Select at least one product for this coupon');
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
