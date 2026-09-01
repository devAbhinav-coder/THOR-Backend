import type { CouponLineScope } from '../coupon/couponBusinessRules';
import {
  buildProgressHint,
  calculatePromotionDiscount,
  eligibleQuantity,
  promotionDisplayLabel,
  promotionMatchesProduct,
  type PromotionLike,
} from './promotionBusinessRules';

export type ProductPromotionDto = {
  displayTitle: string;
  label: string;
  badgeText?: string | null;
  promotionType: string;
  description?: string;
  termsAndConditions?: string;
  /** Shown on PDP when offer matches product but cart qty/min not met yet */
  progressHint?: string;
};

export type ProductNearEligiblePromotionDto = ProductPromotionDto & {
  hintMessage: string;
};

function mapPromotion(promotion: PromotionLike): ProductPromotionDto {
  return {
    displayTitle: promotion.displayTitle?.trim() || promotion.name,
    label: promotionDisplayLabel(promotion),
    badgeText: promotion.badgeText || null,
    promotionType: promotion.promotionType,
    description: promotion.description,
    termsAndConditions: promotion.termsAndConditions,
  };
}

function productPromotionLine(
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

export function getProductPromotionOffers(
  promotions: PromotionLike[],
  product: {
    _id: string;
    categoryId?: string | null;
    subcategoryId?: string | null;
    category?: string | null;
    subcategory?: string | null;
  },
  orderAmount: number,
  quantity = 1,
): {
  activePromotions: ProductPromotionDto[];
  nearEligiblePromotions: ProductNearEligiblePromotionDto[];
} {
  const lines = [productPromotionLine(product, orderAmount, quantity)];
  const activePromotions: ProductPromotionDto[] = [];

  for (const promotion of promotions) {
    if (promotion.showOnStorefront === false) continue;
    if (!promotionMatchesProduct(promotion, product)) continue;

    const dto = mapPromotion(promotion);
    const discount = calculatePromotionDiscount(promotion, lines);
    const eligibleQty = eligibleQuantity(promotion, lines);
    if (eligibleQty <= 0) continue;

    const hint = buildProgressHint(promotion, lines, eligibleQty);

    if (discount > 0) {
      activePromotions.push(dto);
      continue;
    }

    if (hint) {
      // PDP: always surface scoped offers (BOGO / flat / %) — hint explains how to unlock
      activePromotions.push({
        ...dto,
        progressHint: hint.message,
      });
    } else {
      activePromotions.push(dto);
    }
  }

  return { activePromotions, nearEligiblePromotions: [] };
}

/** @deprecated Use getProductPromotionOffers — kept for cart/list callers. */
export function getPromotionsForProduct(
  promotions: PromotionLike[],
  product: {
    _id: string;
    categoryId?: string | null;
    subcategoryId?: string | null;
    category?: string | null;
    subcategory?: string | null;
  },
): ProductPromotionDto[] {
  const { activePromotions, nearEligiblePromotions } = getProductPromotionOffers(
    promotions,
    product,
    0,
    1,
  );
  return [...activePromotions, ...nearEligiblePromotions.map(({ hintMessage: _h, ...rest }) => rest)];
}
