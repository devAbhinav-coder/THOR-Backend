import {
  pickBestPromotion,
  pickPromotionHint,
  promotionDisplayLabel,
  promotionMatchesProduct,
  type AppliedPromotionResult,
  type PromotionLike,
} from './promotionBusinessRules';
import { getActivePromotions } from './promotionCacheService';
import type { CouponLineScope } from '../coupon/couponBusinessRules';

export type CartPromotionHintDto = {
  label: string;
  message: string;
};

export type CartAppliedPromotionDto = {
  _id: string;
  name: string;
  displayTitle: string;
  promotionType: string;
  label: string;
  appliedDiscount: number;
  badgeText?: string | null;
};

export function toCartPromotionDto(result: AppliedPromotionResult): CartAppliedPromotionDto {
  const p = result.promotion;
  return {
    _id: String(p._id),
    name: p.name,
    displayTitle: p.displayTitle?.trim() || p.name,
    promotionType: p.promotionType,
    label: result.label,
    appliedDiscount: result.discount,
    badgeText: p.badgeText || null,
  };
}

export async function resolveCartPromotion(
  lines: CouponLineScope[],
): Promise<{
  promotion: CartAppliedPromotionDto | null;
  discount: number;
  hint: CartPromotionHintDto | null;
}> {
  if (!lines.length) {
    return { promotion: null, discount: 0, hint: null };
  }

  const promotions = await getActivePromotions();
  const best = pickBestPromotion(promotions, lines);
  if (best) {
    return {
      promotion: toCartPromotionDto(best),
      discount: best.discount,
      hint: null,
    };
  }

  const hint = pickPromotionHint(promotions, lines);
  return {
    promotion: null,
    discount: 0,
    hint,
  };
}

export function getPromotionsForProduct(
  promotions: PromotionLike[],
  product: {
    _id: string;
    categoryId?: string | null;
    subcategoryId?: string | null;
    category?: string | null;
    subcategory?: string | null;
  },
): Array<{
  displayTitle: string;
  label: string;
  badgeText?: string | null;
  promotionType: string;
  description?: string;
  termsAndConditions?: string;
}> {
  return promotions
    .filter((p) => p.showOnStorefront !== false && promotionMatchesProduct(p, product))
    .map((p) => ({
      displayTitle: p.displayTitle?.trim() || p.name,
      label: promotionDisplayLabel(p),
      badgeText: p.badgeText || null,
      promotionType: p.promotionType,
      description: p.description,
      termsAndConditions: p.termsAndConditions,
    }));
}
