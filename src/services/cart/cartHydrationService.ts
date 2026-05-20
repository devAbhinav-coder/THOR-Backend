import mongoose from 'mongoose';
import Cart from '../../models/Cart';
import Coupon from '../../models/Coupon';
import {
  calculateCouponDiscount,
  evaluateCouponValidity,
  COUPON_QUERY_MAX_MS,
} from '../coupon/couponBusinessRules';
import { getUserDeliveredOrderCount } from '../coupon/couponUserStatsService';
import { cartCacheService } from './cartCacheService';
import { serializeCartDto, emptyCartDto, type CartDto, type CartCouponDto } from './cartDto';
import { recordCartMetric } from './cartMetricsService';
import { CART_QUERY_MAX_MS } from './cartConstants';
import type { ICartItem } from '../../types';

async function hydrateTotals(
  cart: Record<string, unknown>,
  userId: string
): Promise<CartDto> {
  if (!cart) return emptyCartDto();

  const items = ((cart.items as ICartItem[]) || []).map((item) => ({ ...item }));
  const subtotal = items.reduce((sum, item) => sum + item.price * item.quantity, 0);
  let discount = 0;
  let total = subtotal;
  let couponInfo: CartCouponDto | null = null;

  if (cart.coupon) {
    const couponId = cart.coupon as mongoose.Types.ObjectId;
    const couponDoc = await Coupon.findById(couponId)
      .select('+usedBy')
      .maxTimeMS(COUPON_QUERY_MAX_MS)
      .lean();
    if (couponDoc) {
      const completedOrders = await getUserDeliveredOrderCount(userId);
      const validity = evaluateCouponValidity(couponDoc, userId, subtotal, { completedOrders });

      if (validity.valid) {
        discount = calculateCouponDiscount(couponDoc, subtotal);
        total = subtotal - discount;
        couponInfo = {
          code: couponDoc.code,
          discountType: couponDoc.discountType,
          discountValue: couponDoc.discountValue,
          appliedDiscount: discount,
        };
      }
    }
  }

  if (cart._id) {
    Cart.updateOne(
      { _id: cart._id },
      { $set: { subtotal, discount, total } }
    )
      .maxTimeMS(CART_QUERY_MAX_MS)
      .exec()
      .catch(() => {});
  }

  const hydrated: CartDto = serializeCartDto({
    ...cart,
    items,
    subtotal,
    discount,
    total,
    coupon: couponInfo ?? cart.coupon,
  });

  return hydrated;
}

export const cartHydrationService = {
  async hydrateFromDocument(
    cart: Record<string, unknown> | null,
    userId: string
  ): Promise<CartDto> {
    return hydrateTotals(cart ?? {}, userId);
  },

  async getCartDto(userId: string, options?: { skipCache?: boolean }): Promise<CartDto> {
    if (!options?.skipCache) {
      const cached = await cartCacheService.get(userId);
      if (cached) {
        recordCartMetric('cart.fetch.cache_hit', { userId });
        return cached;
      }
      recordCartMetric('cart.fetch.cache_miss', { userId });
    }

    const cart = await Cart.findOne({ user: userId })
      .lean<Record<string, unknown>>()
      .maxTimeMS(CART_QUERY_MAX_MS);
    const dto = await hydrateTotals(cart ?? {}, userId);
    await cartCacheService.set(userId, dto, dto.version);
    recordCartMetric('cart.fetch', { userId });
    return dto;
  },

  async invalidateAndRefresh(userId: string): Promise<CartDto> {
    await cartCacheService.invalidate(userId);
    return this.getCartDto(userId, { skipCache: true });
  },
};
