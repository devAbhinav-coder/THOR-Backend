import mongoose from 'mongoose';

/** Catalog list subtotal (before admin sale campaigns) vs sale-priced checkout subtotal. */
export function computeCatalogSubtotal(
  checkoutItems: Array<{
    product: unknown;
    variant: { sku: string };
    quantity: number;
    price: number;
  }>,
  productMap: Map<
    string,
    { price: number; variants?: Array<{ sku: string; price?: number }> }
  >,
): number {
  return checkoutItems.reduce((sum, item) => {
    const product = productMap.get(String(item.product));
    if (!product) return sum + Number(item.price) * Number(item.quantity);

    const sku = String(item.variant?.sku || '').trim();
    const variant = product.variants?.find((v) => String(v.sku || '').trim() === sku);
    const catalogUnit =
      variant?.price != null && variant.price >= 0 ?
        Number(variant.price)
      : Number(product.price) || Number(item.price);

    return sum + catalogUnit * Number(item.quantity);
  }, 0);
}

export type CheckoutOfferBreakdown = {
  saleDiscount: number;
  promotionDiscount: number;
  couponDiscount: number;
  discount: number;
  promotionId?: mongoose.Types.ObjectId;
  couponId?: mongoose.Types.ObjectId;
};

export function buildCheckoutOfferBreakdown(input: {
  checkoutSubtotal: number;
  catalogSubtotal: number;
  promotionDiscount: number;
  couponDiscount: number;
  promotionId?: string;
  couponId?: mongoose.Types.ObjectId;
}): CheckoutOfferBreakdown {
  const saleDiscount = Math.max(
    0,
    Math.round((input.catalogSubtotal - input.checkoutSubtotal) * 100) / 100,
  );
  const promotionDiscount = Math.max(0, Number(input.promotionDiscount) || 0);
  const couponDiscount = Math.max(0, Number(input.couponDiscount) || 0);

  return {
    saleDiscount,
    promotionDiscount,
    couponDiscount,
    discount: Math.round((promotionDiscount + couponDiscount) * 100) / 100,
    ...(input.promotionId ?
      { promotionId: new mongoose.Types.ObjectId(input.promotionId) }
    : {}),
    ...(input.couponId ? { couponId: input.couponId } : {}),
  };
}
