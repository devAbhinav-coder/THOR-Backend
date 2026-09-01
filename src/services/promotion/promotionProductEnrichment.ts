import type { PromotionLike } from './promotionBusinessRules';
import { getPublicPromotions } from './promotionCacheService';
import { getProductPromotionOffers } from './promotionProductOffers';
import { enrichPromotionsScopeNames } from './promotionScopeEnrichment';
import {
  getProductCouponOffers,
  getStorefrontCouponsForMatching,
} from '../coupon/couponProductEnrichment';

function productOfferScope(product: Record<string, unknown>) {
  return {
    _id: String(product._id),
    categoryId: product.categoryId ? String(product.categoryId) : null,
    subcategoryId: product.subcategoryId ? String(product.subcategoryId) : null,
    category: product.category ? String(product.category) : null,
    subcategory: product.subcategory ? String(product.subcategory) : null,
  };
}

function productOrderAmount(product: Record<string, unknown>): number {
  const effective = Number(product.effectivePrice);
  if (Number.isFinite(effective) && effective > 0) return effective;
  const price = Number(product.price);
  if (Number.isFinite(price) && price > 0) return price;
  return 0;
}

async function loadScopedPromotions(): Promise<PromotionLike[]> {
  const promotions = await getPublicPromotions();
  return enrichPromotionsScopeNames(promotions);
}

export async function enrichProductWithPromotions(
  product: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const scope = productOfferScope(product);
  const orderAmount = productOrderAmount(product);
  const [promotions, coupons] = await Promise.all([
    loadScopedPromotions(),
    getStorefrontCouponsForMatching(),
  ]);
  const couponOffers = getProductCouponOffers(coupons, scope, orderAmount);
  const promotionOffers = getProductPromotionOffers(
    promotions,
    scope,
    orderAmount,
    1,
  );
  return {
    ...product,
    activePromotions: promotionOffers.activePromotions,
    nearEligiblePromotions: promotionOffers.nearEligiblePromotions,
    activeCoupons: couponOffers.activeCoupons,
    nearEligibleCoupons: couponOffers.nearEligibleCoupons,
  };
}

export async function enrichProductsWithPromotions(
  products: Record<string, unknown>[],
): Promise<Record<string, unknown>[]> {
  const [promotions, coupons] = await Promise.all([
    loadScopedPromotions(),
    getStorefrontCouponsForMatching(),
  ]);
  return products.map((product) => {
    const scope = productOfferScope(product);
    const orderAmount = productOrderAmount(product);
    const couponOffers = getProductCouponOffers(coupons, scope, orderAmount);
    const promotionOffers = getProductPromotionOffers(
      promotions,
      scope,
      orderAmount,
      1,
    );
    return {
      ...product,
      activePromotions: promotionOffers.activePromotions,
      nearEligiblePromotions: promotionOffers.nearEligiblePromotions,
      activeCoupons: couponOffers.activeCoupons,
      nearEligibleCoupons: couponOffers.nearEligibleCoupons,
    };
  });
}

export type { PromotionLike };
