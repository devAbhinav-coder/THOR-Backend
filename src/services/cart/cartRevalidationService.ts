import mongoose from "mongoose";
import Product from "../../models/Product";
import AppError from "../../types/utils/AppError";
import { CART_QUERY_MAX_MS } from "./cartConstants";
import type { CartDto } from "./cartDto";
import { getGiftMinQtyFromRecord } from "./cartValidationService";
import { recordCartMetric } from "./cartMetricsService";
import { getActiveSaleCampaigns } from "../sale/saleCacheService";
import { resolveVariantSellPrice } from "../sale/saleProductEnrichment";

/**
 * Checkout-safe revalidation: prices, active products, variants, soft stock, min qty.
 * Throws 409 when stored cart line prices diverge from live catalog prices.
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
      .select(
        "name isActive variants minOrderQty occasions price comparePrice categoryId subcategoryId",
      )
      .maxTimeMS(CART_QUERY_MAX_MS)
      .lean<Record<string, unknown>[]>();

    const productMap = new Map(products.map((p) => [String(p._id), p]));
    const campaigns = await getActiveSaleCampaigns();
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

      if (item.quantity > variant.stock) {
        throw new AppError(
          `"${item.productName}" — only ${variant.stock} in stock (you have ${item.quantity} in cart). Update quantity and try again.`,
          400,
        );
      }

      const livePrice = resolveVariantSellPrice(
        {
          _id: String(product._id),
          price: Number(product.price) || 0,
          comparePrice: product.comparePrice as number | null | undefined,
          categoryId: product.categoryId as string | null | undefined,
          subcategoryId: product.subcategoryId as string | null | undefined,
        },
        variant as { price?: number },
        campaigns,
      );
      if (Math.abs(Number(item.price) - livePrice) > 0.001) {
        staleCount += 1;
      }
    }

    if (staleCount > 0) {
      recordCartMetric("cart.stale.recovered", { userId, staleCount });
      throw new AppError(
        "Some prices in your cart changed. Please review your cart and try again.",
        409,
      );
    }
  },
};
