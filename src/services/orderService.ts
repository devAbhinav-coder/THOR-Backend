import mongoose from "mongoose";
import Product from "../models/Product";
import AppError from "../utils/AppError";
import { refProductId } from "../utils/productStock";

export const getGiftMinQty = (product: InstanceType<typeof Product>) => {
  const isCorporateGift = (product.giftOccasions || []).some(
    (o) => String(o).trim().toLowerCase() === "corporate",
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
  productMap: Map<string, InstanceType<typeof Product>>,
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
        typeof item.customFieldAnswers === "string" ?
          undefined
        : item.customFieldAnswers,
    };
  });
}

const SHIPPING_THRESHOLD = 1499;
const SHIPPING_CHARGE = 99;
const COD_HANDLING_FEE = 99;

export function computeOrderTotals(
  subtotal: number,
  discount: number,
  paymentMethod: "razorpay" | "cod" = "cod",
) {
  const TAX_RATE = 0;
  const subtotalAfterDiscount = subtotal - discount;
  const shippingCharge =
    subtotalAfterDiscount >= SHIPPING_THRESHOLD ? 0 : SHIPPING_CHARGE;
  const tax = Math.round(subtotalAfterDiscount * TAX_RATE * 100) / 100;
  const codFee = paymentMethod === "cod" ? COD_HANDLING_FEE : 0;
  const total = subtotalAfterDiscount + shippingCharge + tax + codFee;
  return { shippingCharge, tax, total, codFee };
}

export { SHIPPING_THRESHOLD, SHIPPING_CHARGE, COD_HANDLING_FEE };
