import {
  pickBestPromotion,
  pickPromotionHint,
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

export { getPromotionsForProduct } from './promotionProductOffers';
