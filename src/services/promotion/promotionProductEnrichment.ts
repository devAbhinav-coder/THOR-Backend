import type { PromotionLike } from './promotionBusinessRules';
import { getPublicPromotions } from './promotionCacheService';
import { getPromotionsForProduct } from './promotionApplyService';

export async function enrichProductWithPromotions(
  product: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const promotions = await getPublicPromotions();
  const activePromotions = getPromotionsForProduct(promotions, {
    _id: String(product._id),
    categoryId: product.categoryId ? String(product.categoryId) : null,
    subcategoryId: product.subcategoryId ? String(product.subcategoryId) : null,
    category: product.category ? String(product.category) : null,
    subcategory: product.subcategory ? String(product.subcategory) : null,
  });
  return {
    ...product,
    activePromotions,
  };
}

export async function enrichProductsWithPromotions(
  products: Record<string, unknown>[],
): Promise<Record<string, unknown>[]> {
  const promotions = await getPublicPromotions();
  return products.map((product) => ({
    ...product,
    activePromotions: getPromotionsForProduct(promotions, {
      _id: String(product._id),
      categoryId: product.categoryId ? String(product.categoryId) : null,
      subcategoryId: product.subcategoryId ? String(product.subcategoryId) : null,
      category: product.category ? String(product.category) : null,
      subcategory: product.subcategory ? String(product.subcategory) : null,
    }),
  }));
}

export type { PromotionLike };
