import mongoose from "mongoose";
import Product from "../../models/Product";
import AppError from "../../types/utils/AppError";
import { CART_QUERY_MAX_MS } from "./cartConstants";
import type { CartDto } from "./cartDto";
import { getGiftMinQtyFromRecord } from "./cartValidationService";
import { recordCartMetric } from "./cartMetricsService";

/**
 * Checkout-safe revalidation: prices, active products, variants, soft stock, min qty.
 * Used before checkout handoff; does not mutate cart (read-only checks).
 */
export const cartRevalidationService = {
  async assertCartReadyForCheckout(
    userId: string,
    cart: CartDto,
  ): Promise<void> {
    if (!cart.items.length) {
      throw new AppError("Your cart is empty.", 400);
    }

    const productIds = [...new Set(cart.items.map((i) => String(i.product)))];
    const products = await Product.find({
      _id: { $in: productIds.map((id) => new mongoose.Types.ObjectId(id)) },
    })
      .select("name isActive variants minOrderQty giftOccasions price")
      .maxTimeMS(CART_QUERY_MAX_MS)
      .lean<Record<string, unknown>[]>();

    const productMap = new Map(products.map((p) => [String(p._id), p]));
    let staleCount = 0;

    for (const item of cart.items) {
      const product = productMap.get(String(item.product));
      if (!product || !product.isActive) {
        throw new AppError(
          "One or more products in your cart are no longer available.",
          400,
        );
      }

      const minQty = getGiftMinQtyFromRecord(product);
      if (item.quantity < minQty) {
        throw new AppError(
          `Minimum quantity for "${item.productName}" is ${minQty}.`,
          400,
        );
      }

      const variants =
        (product.variants as {
          sku: string;
          stock: number;
          price?: number;
        }[]) || [];
      const variant = variants.find((v) => v.sku === item.variant.sku);
      if (!variant) {
        throw new AppError(
          `Variant for "${item.productName}" is no longer available.`,
          400,
        );
      }

      if (variant.stock < 1) {
        throw new AppError(
          `"${item.productName}" is currently out of stock.`,
          400,
        );
      }

      const livePrice = variant.price ?? (product.price as number);
      if (Math.abs(Number(item.price) - Number(livePrice)) > 0.001) {
        staleCount += 1;
      }
    }

    if (staleCount > 0) {
      recordCartMetric("cart.stale.recovered", { userId, staleCount });
    }
  },
};
