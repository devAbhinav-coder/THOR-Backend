import { cartHydrationService } from './cartHydrationService';
import { cartMutationService } from './cartMutationService';
import { cartCacheService } from './cartCacheService';
import { recordCartMetric } from './cartMetricsService';
import type { CartDto } from './cartDto';
import logger from '../../utils/logger';

/**
 * Cart sync helpers: cache bust, guest merge placeholder, multi-device refresh.
 */
export const cartSyncService = {
  async refreshCart(userId: string): Promise<CartDto> {
    await cartCacheService.invalidate(userId);
    return cartHydrationService.getCartDto(userId, { skipCache: true });
  },

  /**
   * Guest-to-user merge hook. Preserves API compatibility; extend when guest carts are persisted.
   */
  async mergeGuestCartIfPresent(userId: string, _guestToken?: string): Promise<CartDto> {
    logger.info({ msg: 'cart_guest_merge_skipped', userId });
    recordCartMetric('cart.fetch', { userId, phase: 'guest_merge_noop' });
    return cartHydrationService.getCartDto(userId);
  },

  async invalidateAfterExternalChange(userId: string): Promise<void> {
    await cartCacheService.invalidate(userId);
  },

  async clearAndRefresh(userId: string): Promise<CartDto> {
    await cartMutationService.clearCart(userId);
    return { items: [], subtotal: 0, discount: 0, total: 0, coupon: null };
  },
};
