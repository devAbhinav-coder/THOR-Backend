import mongoose from 'mongoose';
import {
  type CouponLineScope,
  type PromoScopeType,
  computeEligibleSubtotal,
  isWithinValidityWindow,
  normalizeExpiryDate,
} from '../coupon/couponBusinessRules';

export type PromotionType = 'bogo' | 'flat' | 'percentage';

export type PromotionLike = {
  _id?: mongoose.Types.ObjectId | string;
  name: string;
  description?: string;
  termsAndConditions?: string;
  displayTitle?: string;
  badgeText?: string;
  imageUrl?: string;
  imagePublicId?: string;
  promotionType: PromotionType;
  buyQuantity?: number;
  getQuantity?: number;
  getDiscountPercent?: number;
  discountValue?: number;
  maxDiscountAmount?: number;
  minOrderAmount?: number;
  scopeType?: PromoScopeType;
  applicableCategories?: string[];
  applicableSubcategoryNames?: string[];
  categoryIds?: (mongoose.Types.ObjectId | string)[];
  subcategoryIds?: (mongoose.Types.ObjectId | string)[];
  productIds?: (mongoose.Types.ObjectId | string)[];
  startDate: Date;
  endDate: Date;
  isActive: boolean;
  showOnStorefront?: boolean;
  priority?: number;
  deletedAt?: Date | null;
  archivedAt?: Date | null;
};

function idSet(ids?: (mongoose.Types.ObjectId | string)[]): Set<string> {
  return new Set((ids || []).map((id) => String(id)).filter(Boolean));
}

export function lineMatchesPromotionScope(
  promotion: PromotionLike,
  line: CouponLineScope,
): boolean {
  const scope = promotion.scopeType || 'all';
  if (scope === 'all') return true;
  if (scope === 'products') {
    return idSet(promotion.productIds).has(String(line.productId));
  }
  if (scope === 'categories') {
    if (line.categoryId && idSet(promotion.categoryIds).has(String(line.categoryId))) {
      return true;
    }
    const names = new Set(
      (promotion.applicableCategories || [])
        .map((n) => String(n).trim().toLowerCase())
        .filter(Boolean),
    );
    if (line.categoryName && names.has(String(line.categoryName).trim().toLowerCase())) {
      return true;
    }
    if (line.subcategoryName && names.has(String(line.subcategoryName).trim().toLowerCase())) {
      return true;
    }
    return false;
  }
  if (scope === 'subcategories') {
    if (
      line.subcategoryId &&
      idSet(promotion.subcategoryIds).has(String(line.subcategoryId))
    ) {
      return true;
    }
    const names = new Set(
      (promotion.applicableSubcategoryNames || [])
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

export function eligibleQuantity(promotion: PromotionLike, lines: CouponLineScope[]): number {
  let qty = 0;
  for (const line of lines) {
    if (lineMatchesPromotionScope(promotion, line)) {
      qty += Math.max(1, Math.floor(Number(line.quantity) || 1));
    }
  }
  return qty;
}

function calculateBogoDiscount(promotion: PromotionLike, lines: CouponLineScope[]): number {
  const buyQty = Math.max(1, Math.floor(Number(promotion.buyQuantity) || 1));
  const getQty = Math.max(1, Math.floor(Number(promotion.getQuantity) || 1));
  const getPct = Math.min(100, Math.max(0, Number(promotion.getDiscountPercent ?? 100)));
  const groupSize = buyQty + getQty;

  const units: number[] = [];
  for (const line of lines) {
    if (!lineMatchesPromotionScope(promotion, line)) continue;
    const qty = Math.max(1, Math.floor(Number(line.quantity) || 1));
    const unitPrice =
      line.unitPrice != null && Number.isFinite(Number(line.unitPrice))
        ? Math.max(0, Number(line.unitPrice))
        : Math.max(0, Number(line.lineTotal) / qty);
    for (let i = 0; i < qty; i++) units.push(unitPrice);
  }

  if (units.length < groupSize) return 0;

  units.sort((a, b) => a - b);
  const sets = Math.floor(units.length / groupSize);
  const discountedCount = sets * getQty;
  let discount = 0;
  for (let i = 0; i < discountedCount; i++) {
    discount += units[i] * (getPct / 100);
  }
  return Math.round(discount * 100) / 100;
}

export function calculatePromotionDiscount(
  promotion: PromotionLike,
  lines: CouponLineScope[],
): number {
  if (!lines.length) return 0;

  const { eligibleSubtotal, matchedLineCount } = computeEligibleSubtotal(
    {
      scopeType: promotion.scopeType || 'all',
      applicableCategories: promotion.applicableCategories,
      applicableSubcategoryNames: promotion.applicableSubcategoryNames,
      applicableCategoryIds: promotion.categoryIds,
      applicableSubcategoryIds: promotion.subcategoryIds,
      applicableProductIds: promotion.productIds,
    } as import('../coupon/couponBusinessRules').CouponLike,
    lines,
  );

  const scope = promotion.scopeType || 'all';
  if (scope !== 'all' && matchedLineCount === 0) return 0;

  const minQty = Math.max(1, Math.floor(Number(promotion.buyQuantity) || 1));
  const eligibleQty = eligibleQuantity(promotion, lines);
  if (eligibleQty < minQty) return 0;

  const minOrder = Number(promotion.minOrderAmount) || 0;
  if (minOrder > 0 && eligibleSubtotal < minOrder) return 0;

  if (promotion.promotionType === 'bogo') {
    return calculateBogoDiscount(promotion, lines);
  }

  const discountVal = Number(promotion.discountValue) || 0;
  if (discountVal <= 0) return 0;

  if (promotion.promotionType === 'percentage') {
    let discount = (eligibleSubtotal * discountVal) / 100;
    if (promotion.maxDiscountAmount) {
      discount = Math.min(discount, promotion.maxDiscountAmount);
    }
    return Math.min(Math.round(discount * 100) / 100, eligibleSubtotal);
  }

  // flat
  return Math.min(discountVal, eligibleSubtotal);
}

export function promotionDisplayLabel(promotion: PromotionLike): string {
  const buy = Math.max(1, Math.floor(Number(promotion.buyQuantity) || 1));
  const get = Math.max(1, Math.floor(Number(promotion.getQuantity) || 1));
  const pct = Number(promotion.getDiscountPercent ?? 100);

  if (promotion.promotionType === 'bogo') {
    if (pct >= 100) return `Buy ${buy} Get ${get} Free`;
    return `Buy ${buy} Get ${get} at ${pct}% off`;
  }
  if (promotion.promotionType === 'percentage') {
    if (buy > 1) return `Buy ${buy}+ · ${promotion.discountValue}% off`;
    return `${promotion.discountValue}% off`;
  }
  // flat
  const amt = promotion.discountValue ?? 0;
  if (buy > 1) return `Buy ${buy}+ · ₹${amt} off`;
  return `₹${amt} off`;
}

export type AppliedPromotionResult = {
  promotion: PromotionLike;
  discount: number;
  label: string;
};

export function pickBestPromotion(
  promotions: PromotionLike[],
  lines: CouponLineScope[],
  now = new Date(),
): AppliedPromotionResult | null {
  let best: AppliedPromotionResult | null = null;

  for (const promotion of promotions) {
    if (promotion.deletedAt || promotion.archivedAt || !promotion.isActive) continue;
    if (!isWithinValidityWindow(promotion.startDate, promotion.endDate, now)) continue;

    const discount = calculatePromotionDiscount(promotion, lines);
    if (discount <= 0) continue;

    const priority = Number(promotion.priority) || 0;
    const candidate: AppliedPromotionResult = {
      promotion,
      discount,
      label: promotionDisplayLabel(promotion),
    };

    if (
      !best ||
      discount > best.discount ||
      (discount === best.discount &&
        priority > (Number(best.promotion.priority) || 0))
    ) {
      best = candidate;
    }
  }

  return best;
}

export type PromotionProgressHint = {
  label: string;
  message: string;
};

export function buildProgressHint(
  promotion: PromotionLike,
  lines: CouponLineScope[],
  eligibleQty: number,
): PromotionProgressHint | null {
  const label = promotionDisplayLabel(promotion);

  if (promotion.promotionType === 'bogo') {
    const buy = Math.max(1, Math.floor(Number(promotion.buyQuantity) || 1));
    const get = Math.max(1, Math.floor(Number(promotion.getQuantity) || 1));
    const needed = buy + get;
    if (eligibleQty >= needed) return null;
    const short = needed - eligibleQty;
    return {
      label,
      message: `Add ${short} more item${short > 1 ? 's' : ''} for ${label}`,
    };
  }

  const minQty = Math.max(1, Math.floor(Number(promotion.buyQuantity) || 1));
  if (eligibleQty < minQty) {
    const short = minQty - eligibleQty;
    return {
      label,
      message: `Add ${short} more item${short > 1 ? 's' : ''} for ${label}`,
    };
  }

  const minOrder = Number(promotion.minOrderAmount) || 0;
  if (minOrder > 0) {
    const { eligibleSubtotal, matchedLineCount } = computeEligibleSubtotal(
      {
        scopeType: promotion.scopeType || 'all',
        applicableCategories: promotion.applicableCategories,
        applicableSubcategoryNames: promotion.applicableSubcategoryNames,
        applicableCategoryIds: promotion.categoryIds,
        applicableSubcategoryIds: promotion.subcategoryIds,
        applicableProductIds: promotion.productIds,
      } as import('../coupon/couponBusinessRules').CouponLike,
      lines,
    );
    if (matchedLineCount > 0 && eligibleSubtotal < minOrder) {
      const gap = Math.ceil(minOrder - eligibleSubtotal);
      return {
        label,
        message: `Add ₹${gap} more on eligible items for ${label}`,
      };
    }
  }

  return null;
}

/** When offer matches cart but discount not unlocked yet — nudge shopper. */
export function pickPromotionHint(
  promotions: PromotionLike[],
  lines: CouponLineScope[],
  now = new Date(),
): PromotionProgressHint | null {
  if (!lines.length) return null;

  let best: { hint: PromotionProgressHint; closeness: number } | null = null;

  for (const promotion of promotions) {
    if (promotion.deletedAt || promotion.archivedAt || !promotion.isActive) continue;
    if (!isWithinValidityWindow(promotion.startDate, promotion.endDate, now)) continue;

    const eligibleQty = eligibleQuantity(promotion, lines);
    if (eligibleQty === 0) continue;

    if (calculatePromotionDiscount(promotion, lines) > 0) continue;

    const hint = buildProgressHint(promotion, lines, eligibleQty);
    if (!hint) continue;

    let required = 1;
    if (promotion.promotionType === 'bogo') {
      required = Math.max(1, (promotion.buyQuantity ?? 1) + (promotion.getQuantity ?? 1));
    } else {
      required = Math.max(1, promotion.buyQuantity ?? 1);
    }
    const closeness = eligibleQty / required;

    if (!best || closeness > best.closeness) {
      best = { hint, closeness };
    }
  }

  return best?.hint ?? null;
}

export function promotionMatchesProduct(
  promotion: PromotionLike,
  product: {
    _id: string;
    categoryId?: string | null;
    subcategoryId?: string | null;
    category?: string | null;
    subcategory?: string | null;
  },
): boolean {
  return lineMatchesPromotionScope(promotion, {
    productId: String(product._id),
    categoryId: product.categoryId ? String(product.categoryId) : null,
    subcategoryId: product.subcategoryId ? String(product.subcategoryId) : null,
    categoryName: product.category || null,
    subcategoryName: product.subcategory || null,
    lineTotal: 0,
    quantity: 1,
  });
}

export function assertPromotionBusinessRules(input: {
  promotionType: PromotionType;
  buyQuantity?: number;
  getQuantity?: number;
  getDiscountPercent?: number;
  discountValue?: number;
  startDate: Date;
  endDate: Date;
  scopeType?: PromoScopeType;
  categoryIds?: unknown[];
  subcategoryIds?: unknown[];
  productIds?: unknown[];
}): void {
  if (input.endDate <= input.startDate) {
    throw new Error('End date must be after start date');
  }
  if (input.promotionType === 'percentage' && (input.discountValue ?? 0) > 100) {
    throw new Error('Percentage discount cannot exceed 100');
  }
  if (input.promotionType === 'bogo') {
    if (!input.buyQuantity || input.buyQuantity < 1) {
      throw new Error('Buy quantity must be at least 1 for BOGO');
    }
    if (!input.getQuantity || input.getQuantity < 1) {
      throw new Error('Get quantity must be at least 1 for BOGO');
    }
  } else if (!input.discountValue || input.discountValue <= 0) {
    throw new Error('Discount value is required');
  }
  const scope = input.scopeType || 'all';
  if (scope === 'categories' && !(input.categoryIds?.length)) {
    throw new Error('Select at least one category');
  }
  if (scope === 'subcategories' && !(input.subcategoryIds?.length)) {
    throw new Error('Select at least one subcategory');
  }
  if (scope === 'products' && !(input.productIds?.length)) {
    throw new Error('Select at least one product');
  }
}

export { normalizeExpiryDate, isWithinValidityWindow };
