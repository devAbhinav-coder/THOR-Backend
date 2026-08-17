import mongoose from 'mongoose';
import Cart from '../../models/Cart';
import Coupon from '../../models/Coupon';
import {
  calculateCouponDiscount,
  evaluateCouponValidity,
  COUPON_QUERY_MAX_MS,
} from '../coupon/couponBusinessRules';
import { buildCouponLinesFromCartItems } from '../coupon/couponLineScopeService';
import { getUserDeliveredOrderCount } from '../coupon/couponUserStatsService';
import { resolveCartPromotion } from '../promotion/promotionApplyService';
import { repriceCartItemsWithActiveSales } from './cartRepricingService';
import { cartCacheService } from './cartCacheService';
import {
  serializeCartDto,
  emptyCartDto,
  type CartDto,
  type CartCouponDto,
  type CartPromotionDto,
} from './cartDto';
import { recordCartMetric } from './cartMetricsService';
import { CART_QUERY_MAX_MS } from './cartConstants';
import type { ICartItem } from '../../types';

async function hydrateTotals(
  cart: Record<string, unknown>,
  userId: string
): Promise<CartDto> {
  if (!cart) return emptyCartDto();

  let items = ((cart.items as ICartItem[]) || []).map((item) => ({ ...item }));
  const repriced = await repriceCartItemsWithActiveSales(items);
  items = repriced.items;

  if (repriced.changed && cart._id) {
    Cart.updateOne({ _id: cart._id }, { $set: { items } })
      .maxTimeMS(CART_QUERY_MAX_MS)
      .exec()
      .catch(() => {});
  }

  const subtotal = items.reduce((sum, item) => sum + item.price * item.quantity, 0);

  let promotionDiscount = 0;
  let couponDiscount = 0;
  let promotionInfo: CartPromotionDto | null = null;
  let promotionHint: CartDto['promotionHint'] = null;
  let couponInfo: CartCouponDto | null = null;

  const lines = items.length ? await buildCouponLinesFromCartItems(items) : [];

  if (lines.length) {
    const promoResult = await resolveCartPromotion(lines);
    promotionDiscount = promoResult.discount;
    promotionInfo = promoResult.promotion;
    promotionHint = promoResult.hint;
  }

  const clearCouponOnCart = () => {
    if (!cart._id) return;
    Cart.updateOne(
      { _id: cart._id },
      {
        $unset: { coupon: '' },
        $set: {
          subtotal,
          discount: promotionDiscount,
          total: Math.max(0, subtotal - promotionDiscount),
        },
      },
    )
      .maxTimeMS(CART_QUERY_MAX_MS)
      .exec()
      .then(() => cartCacheService.invalidate(userId))
      .catch(() => {});
  };

  if (cart.coupon) {
    const couponId = cart.coupon as mongoose.Types.ObjectId;
    const couponDoc = await Coupon.findById(couponId)
      .select('+usedBy')
      .maxTimeMS(COUPON_QUERY_MAX_MS)
      .lean();
    if (couponDoc) {
      let couponForEval = couponDoc as typeof couponDoc & {
        applicableCategories?: string[];
        applicableSubcategoryNames?: string[];
      };
      const scope = String(couponDoc.scopeType || 'all');
      if (
        scope === 'categories' &&
        !(couponDoc.applicableCategories as string[] | undefined)?.length &&
        (couponDoc.applicableCategoryIds as unknown[] | undefined)?.length
      ) {
        const Category = (await import('../../models/Category')).default;
        const cats = await Category.find({
          _id: { $in: couponDoc.applicableCategoryIds as mongoose.Types.ObjectId[] },
        })
          .select('name')
          .maxTimeMS(COUPON_QUERY_MAX_MS)
          .lean<{ name: string }[]>();
        couponForEval = {
          ...couponDoc,
          applicableCategories: cats.map((c) => c.name).filter(Boolean),
        };
      } else if (
        scope === 'subcategories' &&
        !(couponDoc as { applicableSubcategoryNames?: string[] }).applicableSubcategoryNames
          ?.length &&
        (couponDoc.applicableSubcategoryIds as unknown[] | undefined)?.length
      ) {
        const SubCategory = (await import('../../models/SubCategory')).default;
        const subs = await SubCategory.find({
          _id: { $in: couponDoc.applicableSubcategoryIds as mongoose.Types.ObjectId[] },
        })
          .select('name')
          .maxTimeMS(COUPON_QUERY_MAX_MS)
          .lean<{ name: string }[]>();
        couponForEval = {
          ...couponDoc,
          applicableSubcategoryNames: subs.map((s) => s.name).filter(Boolean),
        };
      }

      const completedOrders = await getUserDeliveredOrderCount(userId);
      const validity = evaluateCouponValidity(couponForEval, userId, subtotal, {
        completedOrders,
        lines,
      });

      if (validity.valid) {
        const eligible =
          validity.eligibleAmount !== undefined ? validity.eligibleAmount : subtotal;
        couponDiscount = calculateCouponDiscount(couponForEval, eligible, lines);
        if (couponDiscount <= 0) {
          couponDiscount = 0;
          couponInfo = null;
          clearCouponOnCart();
        } else {
          couponInfo = {
            code: couponDoc.code,
            discountType: couponDoc.discountType,
            discountValue: couponDoc.discountValue,
            appliedDiscount: couponDiscount,
          };
        }
      } else {
        clearCouponOnCart();
      }
    } else {
      clearCouponOnCart();
    }
  }

  const totalDiscount = promotionDiscount + couponDiscount;
  const total = Math.max(0, subtotal - totalDiscount);

  if (cart._id) {
    Cart.updateOne(
      { _id: cart._id },
      { $set: { subtotal, discount: totalDiscount, total } },
    )
      .maxTimeMS(CART_QUERY_MAX_MS)
      .exec()
      .catch(() => {});
  }

  const hydrated: CartDto = serializeCartDto({
    ...cart,
    items,
    subtotal,
    promotionDiscount,
    couponDiscount,
    discount: totalDiscount,
    total,
    promotion: promotionInfo,
    promotionHint,
    coupon: couponInfo,
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
      } else {
        recordCartMetric('cart.fetch.cache_miss', { userId });
      }
    } else {
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
