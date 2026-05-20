import mongoose from 'mongoose';
import { cartHydrationService } from './cartHydrationService';
import { cartMutationService } from './cartMutationService';
import { cartCacheService } from './cartCacheService';
import { emitCartEvent } from './cartEventService';
import type { CartDto } from './cartDto';
import type { NormalizedCustomFieldAnswer } from './cartValidationService';
import type { CartProductRecord } from './cartProductService';

export { generateCustomizationHash, generateCartItemId } from './cartHash';
export { cartRevalidationService } from './cartRevalidationService';
export { cartSyncService } from './cartSyncService';
export { cartAnalyticsService } from './cartAnalyticsService';

/**
 * Public cart facade — preserves legacy `cartService` import paths and method signatures.
 */
export const cartService = {
  async getCart(userId: string): Promise<CartDto> {
    return cartHydrationService.getCartDto(userId);
  },

  async clearCartCache(userId: string): Promise<void> {
    await cartCacheService.invalidate(userId);
  },

  async addItem(
    userId: string,
    product: CartProductRecord,
    variantSku: string,
    quantity: number,
    customAnswers: NormalizedCustomFieldAnswer[]
  ): Promise<CartDto> {
    const dto = await cartMutationService.addItem(
      userId,
      product,
      variantSku,
      quantity,
      customAnswers
    );
    emitCartEvent({
      type: 'cart.item.added',
      userId,
      productId: String(product._id),
      quantity,
    });
    return dto;
  },

  async updateItemQty(
    userId: string,
    cartItemId: string,
    quantity: number
  ): Promise<CartDto> {
    const dto = await cartMutationService.updateItemQty(userId, cartItemId, quantity);
    emitCartEvent({ type: 'cart.item.updated', userId, cartItemId, quantity });
    return dto;
  },

  async removeItem(userId: string, cartItemId: string): Promise<CartDto> {
    const dto = await cartMutationService.removeItem(userId, cartItemId);
    emitCartEvent({ type: 'cart.item.removed', userId, cartItemId });
    return dto;
  },

  async applyCoupon(
    userId: string,
    couponId: mongoose.Types.ObjectId
  ): Promise<CartDto> {
    const dto = await cartMutationService.applyCoupon(userId, couponId);
    emitCartEvent({ type: 'cart.coupon.applied', userId });
    return dto;
  },

  async removeCoupon(userId: string): Promise<CartDto> {
    const dto = await cartMutationService.removeCoupon(userId);
    emitCartEvent({ type: 'cart.coupon.removed', userId });
    return dto;
  },

  async clearCart(userId: string): Promise<void> {
    await cartMutationService.clearCart(userId);
    emitCartEvent({ type: 'cart.cleared', userId });
  },
};
