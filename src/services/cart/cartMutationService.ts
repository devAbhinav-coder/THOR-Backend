import mongoose from 'mongoose';
import Cart from '../../models/Cart';
import AppError from '../../utils/AppError';
import { withCartMutationLock } from './cartLockService';
import { cartHydrationService } from './cartHydrationService';
import { cartCacheService } from './cartCacheService';
import { generateCartItemId, generateCustomizationHash } from './cartHash';
import { recordCartMetric } from './cartMetricsService';
import type { CartDto } from './cartDto';
import type { CartProductRecord } from './cartProductService';
import type { NormalizedCustomFieldAnswer } from './cartValidationService';
import { CART_QUERY_MAX_MS, CART_VERSION_MAX_RETRIES } from './cartConstants';

type CartLineVariant = {
  sku: string;
  size?: string;
  color?: string;
  colorCode?: string;
  price?: number;
  stock: number;
};

async function bumpCartVersion(
  userId: string,
  update: Record<string, unknown>,
  options?: { arrayFilters?: { 'line.cartItemId': string }[] }
): Promise<Record<string, unknown> | null> {
  const filter = { user: userId };

  for (let attempt = 0; attempt < CART_VERSION_MAX_RETRIES; attempt++) {
    const existing = await Cart.findOne(filter).select('version').lean<{ version?: number }>();
    const version = existing?.version ?? 0;

    const result = await Cart.findOneAndUpdate(
      { ...filter, version },
      { ...update, $inc: { version: 1 } },
      {
        new: true,
        lean: true,
        ...(options?.arrayFilters ? { arrayFilters: options.arrayFilters } : {}),
      }
    ).maxTimeMS(CART_QUERY_MAX_MS);

    if (result) return result as Record<string, unknown>;
    recordCartMetric('cart.version.conflict', { userId, attempt });
  }

  recordCartMetric('cart.lock.contention', { userId });
  throw new AppError('Cart update conflict. Please retry.', 409);
}

function buildLineItem(
  product: CartProductRecord,
  variant: CartLineVariant,
  quantity: number,
  customAnswers: NormalizedCustomFieldAnswer[]
) {
  const hash = generateCustomizationHash(customAnswers);
  const cartItemId = generateCartItemId(variant.sku, hash);
  const price = variant.price ?? (product.price as number);

  return {
    cartItemId,
    product: product._id,
    productName: product.name,
    productSlug: product.slug,
    productImage: (product.images as { url: string }[])?.[0]?.url || '',
    isActive: product.isActive,
    variant: {
      size: variant.size,
      color: variant.color,
      colorCode: variant.colorCode,
      sku: variant.sku,
      stock: variant.stock,
    },
    quantity,
    price,
    customFieldAnswers: customAnswers,
    customizationHash: hash,
  };
}

export const cartMutationService = {
  async addItem(
    userId: string,
    product: CartProductRecord,
    variantSku: string,
    quantity: number,
    customAnswers: NormalizedCustomFieldAnswer[]
  ): Promise<CartDto> {
    return withCartMutationLock(userId, async () => {
      const variants = (product.variants as CartLineVariant[]) || [];
      const variant = variants.find((v) => v.sku === variantSku);
      if (!variant) throw new AppError('Variant not found.', 404);

      const newItem = buildLineItem(product, variant, quantity, customAnswers);
      const { cartItemId } = newItem;

      const incResult = await Cart.findOneAndUpdate(
        { user: userId, 'items.cartItemId': cartItemId },
        { $inc: { 'items.$.quantity': quantity, version: 1 } },
        { new: true, lean: true }
      ).maxTimeMS(CART_QUERY_MAX_MS);

      if (!incResult) {
        await Cart.findOneAndUpdate(
          { user: userId },
          { $push: { items: newItem }, $inc: { version: 1 } },
          { upsert: true, new: true, lean: true }
        ).maxTimeMS(CART_QUERY_MAX_MS);
      }

      await cartCacheService.invalidate(userId);
      recordCartMetric('cart.item.added', { userId, productId: String(product._id) });
      return cartHydrationService.getCartDto(userId, { skipCache: true });
    });
  },

  async updateItemQty(
    userId: string,
    cartItemId: string,
    quantity: number
  ): Promise<CartDto> {
    return withCartMutationLock(userId, async () => {
      await bumpCartVersion(
        userId,
        { $set: { 'items.$[line].quantity': quantity } },
        { arrayFilters: [{ 'line.cartItemId': cartItemId }] }
      );
      await cartCacheService.invalidate(userId);
      recordCartMetric('cart.item.updated', { userId, cartItemId });
      return cartHydrationService.getCartDto(userId, { skipCache: true });
    });
  },

  async removeItem(userId: string, cartItemId: string): Promise<CartDto> {
    return withCartMutationLock(userId, async () => {
      await bumpCartVersion(userId, { $pull: { items: { cartItemId } } });
      await cartCacheService.invalidate(userId);
      recordCartMetric('cart.item.removed', { userId, cartItemId });
      return cartHydrationService.getCartDto(userId, { skipCache: true });
    });
  },

  async applyCoupon(
    userId: string,
    couponId: mongoose.Types.ObjectId
  ): Promise<CartDto> {
    return withCartMutationLock(userId, async () => {
      await bumpCartVersion(userId, { $set: { coupon: couponId } });
      await cartCacheService.invalidate(userId);
      recordCartMetric('cart.coupon.applied', { userId });
      return cartHydrationService.getCartDto(userId, { skipCache: true });
    });
  },

  async removeCoupon(userId: string): Promise<CartDto> {
    return withCartMutationLock(userId, async () => {
      await bumpCartVersion(userId, { $unset: { coupon: '' }, $set: { discount: 0 } });
      await cartCacheService.invalidate(userId);
      recordCartMetric('cart.coupon.removed', { userId });
      return cartHydrationService.getCartDto(userId, { skipCache: true });
    });
  },

  async clearCart(userId: string): Promise<void> {
    return withCartMutationLock(userId, async () => {
      await Cart.findOneAndDelete({ user: userId }).maxTimeMS(CART_QUERY_MAX_MS);
      await cartCacheService.invalidate(userId);
      recordCartMetric('cart.cleared', { userId });
    });
  },
};
