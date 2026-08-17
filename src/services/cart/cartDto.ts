import mongoose from 'mongoose';
import { ICartItem } from '../../types';

export type CartCouponDto = {
  code: string;
  discountType: string;
  discountValue: number;
  appliedDiscount: number;
};

export type CartPromotionHintDto = {
  label: string;
  message: string;
};

export type CartPromotionDto = {
  _id: string;
  name: string;
  displayTitle: string;
  promotionType: string;
  label: string;
  appliedDiscount: number;
  badgeText?: string | null;
};

export type CartDto = {
  _id?: mongoose.Types.ObjectId;
  user?: mongoose.Types.ObjectId;
  items: ICartItem[];
  subtotal: number;
  promotionDiscount: number;
  couponDiscount: number;
  discount: number;
  total: number;
  promotion?: CartPromotionDto | null;
  promotionHint?: CartPromotionHintDto | null;
  coupon?: CartCouponDto | mongoose.Types.ObjectId | null;
  version?: number;
  createdAt?: Date;
  updatedAt?: Date;
};

export function serializeCartItem(item: ICartItem): ICartItem {
  return {
    cartItemId: item.cartItemId,
    product: item.product,
    productName: item.productName,
    productSlug: item.productSlug,
    productImage: item.productImage,
    isActive: item.isActive,
    variant: {
      size: item.variant?.size,
      color: item.variant?.color,
      colorCode: item.variant?.colorCode,
      sku: item.variant.sku,
      stock: item.variant.stock,
    },
    quantity: item.quantity,
    price: item.price,
    ...(item.customFieldAnswers?.length
      ? { customFieldAnswers: item.customFieldAnswers }
      : {}),
    ...(item.customizationHash ? { customizationHash: item.customizationHash } : {}),
  };
}

export function serializeCartDto(cart: Record<string, unknown>): CartDto {
  const items = ((cart.items as ICartItem[]) || []).map(serializeCartItem);
  return {
    ...(cart._id ? { _id: cart._id as mongoose.Types.ObjectId } : {}),
    ...(cart.user ? { user: cart.user as mongoose.Types.ObjectId } : {}),
    items,
    subtotal: Number(cart.subtotal ?? 0),
    promotionDiscount: Number(cart.promotionDiscount ?? 0),
    couponDiscount: Number(cart.couponDiscount ?? 0),
    discount: Number(cart.discount ?? 0),
    total: Number(cart.total ?? 0),
    promotion: (cart.promotion as CartDto['promotion']) ?? null,
    promotionHint: (cart.promotionHint as CartDto['promotionHint']) ?? null,
    coupon: (cart.coupon as CartDto['coupon']) ?? null,
    ...(cart.version !== undefined ? { version: Number(cart.version) } : {}),
    ...(cart.createdAt ? { createdAt: cart.createdAt as Date } : {}),
    ...(cart.updatedAt ? { updatedAt: cart.updatedAt as Date } : {}),
  };
}

export function emptyCartDto(): CartDto {
  return {
    items: [],
    subtotal: 0,
    promotionDiscount: 0,
    couponDiscount: 0,
    discount: 0,
    total: 0,
    promotion: null,
    promotionHint: null,
    coupon: null,
  };
}
