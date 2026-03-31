import mongoose from "mongoose";
import Product from "../models/Product";
import AppError from "../utils/AppError";
import { refProductId } from "../utils/productStock";

export const getGiftMinQty = (product: InstanceType<typeof Product>) => {
  const isCorporateGift = (product.giftOccasions || []).some(
    (o) => String(o).trim().toLowerCase() === "corporate"
  );
  const baseMin = Math.max(Number(product.minOrderQty || 1), 1);
  return isCorporateGift ? Math.max(baseMin, 10) : baseMin;
};

export function buildOrderItemsFromProducts(
  cartItems: {
    product: mongoose.Types.ObjectId | { _id: mongoose.Types.ObjectId };
    variant: { sku: string };
    quantity: number;
    price: number;
    customFieldAnswers?: { label: string; value: string }[] | string;
  }[],
  productMap: Map<string, InstanceType<typeof Product>>
) {
  return cartItems.map((item) => {
    const pid = refProductId(item.product);
    const product = productMap.get(pid);
    if (!product || !product.images?.[0]) {
      throw new AppError("Product data missing for order line.", 400);
    }
    return {
      product: new mongoose.Types.ObjectId(pid),
      name: product.name,
      image: product.images[0].url,
      variant: item.variant,
      quantity: item.quantity,
      price: item.price,
      customFieldAnswers:
        typeof item.customFieldAnswers === "string" ? undefined : item.customFieldAnswers,
    };
  });
}

export function computeOrderTotals(subtotal: number, discount: number) {
  const SHIPPING_THRESHOLD = 1000;
  const SHIPPING_CHARGE = 100;
  const TAX_RATE = 0;
  const subtotalAfterDiscount = subtotal - discount;
  const shippingCharge = subtotalAfterDiscount >= SHIPPING_THRESHOLD ? 0 : SHIPPING_CHARGE;
  const tax = Math.round(subtotalAfterDiscount * TAX_RATE * 100) / 100;
  const total = subtotalAfterDiscount + shippingCharge + tax;
  return { shippingCharge, tax, total };
}
