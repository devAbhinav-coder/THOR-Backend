import mongoose from "mongoose";
import Product from "../models/Product";
import AppError from "../types/utils/AppError";
import { refProductId } from "../types/utils/productStock";
import { getActiveSaleCampaigns } from "./sale/saleCacheService";
import { resolveVariantSellPrice } from "./sale/saleProductEnrichment";
import { buildSaleScopeContext } from "./sale/saleScopeResolver";

export const getGiftMinQty = (product: InstanceType<typeof Product>) => {
  const isCorporateGift = (product.occasions || []).some(
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
      slug: product.slug,
      image: product.images[0].url,
      variant: item.variant,
      quantity: item.quantity,
      price: Number(item.price),
      customFieldAnswers:
        typeof item.customFieldAnswers === "string" ?
          undefined
        : item.customFieldAnswers,
    };
  });
}

/** Checkout/order lines at live sale prices (never raw catalog list price). */
export async function buildOrderItemsFromProductsWithSalePricing(
  cartItems: {
    product: mongoose.Types.ObjectId | { _id: mongoose.Types.ObjectId };
    variant: { sku: string; price?: number };
    quantity: number;
    price: number;
    customFieldAnswers?: { label: string; value: string }[] | string;
  }[],
  productMap: Map<string, InstanceType<typeof Product>>,
) {
  const campaigns = await getActiveSaleCampaigns();
  const scopeCtx = await buildSaleScopeContext(
    [...productMap.values()].map((p) => ({
      _id: p._id,
      categoryId: p.categoryId,
      subcategoryId: p.subcategoryId,
      category: p.category,
      subcategory: p.subcategory,
    })) as Record<string, unknown>[],
  );
  return cartItems.map((item) => {
    const pid = refProductId(item.product);
    const product = productMap.get(pid);
    if (!product || !product.images?.[0]) {
      throw new AppError("Product data missing for order line.", 400);
    }
    const sku = String(item.variant?.sku || "").trim();
    const variant =
      product.variants?.find((v) => String(v.sku || "").trim() === sku) ||
      item.variant;
    const price = resolveVariantSellPrice(
      {
        _id: pid,
        price: Number(product.price) || 0,
        comparePrice: product.comparePrice,
        categoryId: product.categoryId ? String(product.categoryId) : null,
        subcategoryId: product.subcategoryId ? String(product.subcategoryId) : null,
        category: product.category ? String(product.category) : null,
        subcategory: product.subcategory ? String(product.subcategory) : null,
      },
      variant,
      campaigns,
      scopeCtx,
    );
    return {
      product: new mongoose.Types.ObjectId(pid),
      name: product.name,
      slug: product.slug,
      image: product.images[0].url,
      variant: item.variant,
      quantity: item.quantity,
      price,
      customFieldAnswers:
        typeof item.customFieldAnswers === "string" ?
          undefined
        : item.customFieldAnswers,
    };
  });
}

const SHIPPING_THRESHOLD = 1099;
const SHIPPING_CHARGE = 99;
const COD_HANDLING_FEE = 99;

export function computeOrderTotals(
  subtotal: number,
  discount: number,
  paymentMethod: "razorpay" | "cod" | "offline_upi" | "offline_cash" = "cod",
) {
  const TAX_RATE = 0;
  const subtotalAfterDiscount = Math.max(0, subtotal - discount);
  const shippingCharge =
    subtotalAfterDiscount >= SHIPPING_THRESHOLD ? 0 : SHIPPING_CHARGE;
  const tax = Math.round(subtotalAfterDiscount * TAX_RATE * 100) / 100;
  /** Only website COD charges the handling fee; offline stall/card/UPI does not. */
  const codFee = paymentMethod === "cod" ? COD_HANDLING_FEE : 0;
  const total = subtotalAfterDiscount + shippingCharge + tax + codFee;
  return { shippingCharge, tax, total, codFee };
}

export { SHIPPING_THRESHOLD, SHIPPING_CHARGE, COD_HANDLING_FEE };
