import mongoose from "mongoose";
import Product from "../models/Product";
import Order from "../models/Order";
import { couponValidationService } from "./coupon/couponValidationService";
import { couponRedemptionService } from "./coupon/couponRedemptionService";
import CheckoutPaymentIntent from "../models/CheckoutPaymentIntent";
import AppError from "../types/utils/AppError";
import { orderRepository } from "../repositories/orderRepository";
import {
  getGiftMinQty,
  computeOrderTotals,
  buildOrderItemsFromProductsWithSalePricing,
} from "./orderService";
import { cartService } from "./cartService";
import { emitCartEvent } from "./cart/cartEventService";
import { cartRevalidationService } from "./cart/cartRevalidationService";
import { getActiveSaleCampaigns } from "./sale/saleCacheService";
import { resolveVariantSellPrice } from "./sale/saleProductEnrichment";
import { buildSaleScopeContext } from "./sale/saleScopeResolver";
import { buildCouponLinesFromCartItems } from "./coupon/couponLineScopeService";
import { resolveCartPromotion } from "./promotion/promotionApplyService";
import { createRazorpayOrder } from "./razorpay";
import { decrementVariantStock } from "./inventoryService";
import type { CheckoutIntentSnapshotItem } from "../models/CheckoutPaymentIntent";
import {
  sessionOpts,
  withOptionalTransaction,
} from "../types/utils/mongoTransaction";

function findVariantBySku(
  product: InstanceType<typeof Product>,
  sku: string,
) {
  const normalized = String(sku || "").trim();
  if (!normalized) return undefined;
  return product.variants?.find(
    (v) => String(v.sku || "").trim() === normalized,
  );
}

export const checkoutService = {
  async resolveBuyNowLine(buyNowItem: {
    productId: string;
    variant: { sku: string; size?: string; color?: string; colorCode?: string };
    quantity: number;
    customFieldAnswers?: { label: string; value: string }[];
  }) {
    const productId = String(buyNowItem?.productId || "").trim();
    if (!mongoose.Types.ObjectId.isValid(productId)) {
      throw new AppError("Invalid product.", 400);
    }

    const product = await Product.findById(productId);
    if (!product) {
      throw new AppError("This product is no longer available.", 404);
    }
    if (!product.isActive) {
      throw new AppError(`"${product.name}" is currently unavailable.`, 400);
    }

    const quantity = Math.max(1, Math.floor(Number(buyNowItem.quantity) || 1));
    const minQty = getGiftMinQty(product);
    if (quantity < minQty) {
      throw new AppError(
        `Minimum quantity for "${product.name}" is ${minQty}.`,
        400,
      );
    }

    const variant = findVariantBySku(product, buyNowItem.variant?.sku);
    if (!variant) {
      throw new AppError(
        `Selected variant for "${product.name}" is no longer available.`,
        400,
      );
    }
    if (variant.stock < quantity) {
      throw new AppError(`Insufficient stock for "${product.name}".`, 409);
    }

    const campaigns = await getActiveSaleCampaigns();
    const scopeCtx = await buildSaleScopeContext([
      {
        _id: product._id,
        categoryId: product.categoryId,
        subcategoryId: product.subcategoryId,
        category: product.category,
        subcategory: product.subcategory,
      },
    ] as Record<string, unknown>[]);

    const linePrice = resolveVariantSellPrice(
      {
        _id: String(product._id),
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

    const normalizedVariant = {
      ...buyNowItem.variant,
      sku: String(variant.sku || buyNowItem.variant.sku).trim(),
    };

    const checkoutItems = [
      {
        product: product._id as mongoose.Types.ObjectId,
        variant: normalizedVariant,
        quantity,
        price: linePrice,
        customFieldAnswers: buyNowItem.customFieldAnswers,
      },
    ];
    const checkoutSubtotal = linePrice * quantity;

    return {
      product,
      variant,
      linePrice,
      quantity,
      checkoutItems,
      checkoutSubtotal,
    };
  },

  async previewBuyNowCheckout(buyNowItem: {
    productId: string;
    variant: { sku: string; size?: string; color?: string; colorCode?: string };
    quantity: number;
  }) {
    const resolved = await this.resolveBuyNowLine(buyNowItem);
    const { product, variant, linePrice, quantity, checkoutSubtotal } = resolved;

    const lines = await buildCouponLinesFromCartItems(
      resolved.checkoutItems.map((item) => ({
        product: item.product,
        price: item.price,
        quantity: item.quantity,
      })),
    );
    const promo = await resolveCartPromotion(lines);

    return {
      productId: String(product._id),
      name: product.name,
      price: linePrice,
      subtotal: checkoutSubtotal,
      quantity,
      maxStock: variant.stock,
      minQuantity: getGiftMinQty(product),
      variantSku: String(variant.sku || "").trim(),
      promotion: promo.promotion,
      promotionDiscount: promo.discount,
      promotionHint: promo.hint,
    };
  },

  async processBuyNowItem(buyNowItem: any) {
    const resolved = await this.resolveBuyNowLine(buyNowItem);
    const productMap = new Map([[String(resolved.product._id), resolved.product]]);

    return {
      checkoutItems: resolved.checkoutItems,
      checkoutSubtotal: resolved.checkoutSubtotal,
      productMap,
      cartIdToDelete: null,
      cartCouponId: undefined,
      cartCouponDiscount: 0,
    };
  },

  async processCartItems(userId: string) {
    const cartDto = await cartService.getCart(userId);
    await cartRevalidationService.assertCartReadyForCheckout(userId, cartDto);

    const cart = await orderRepository.findCartForCheckout(userId);
    if (!cart || cart.items.length === 0) {
      throw new AppError("Your cart is empty.", 400);
    }

    const cartIdToDelete = cart._id as mongoose.Types.ObjectId;

    let cartCouponDiscount = 0;
    let cartCouponId: mongoose.Types.ObjectId | undefined;
    let cartPromotionDiscount = cartDto.promotionDiscount ?? 0;
    let cartPromotionId: string | undefined = cartDto.promotion?._id;

    if (cart.coupon) {
      cartCouponDiscount = cartDto.couponDiscount ?? cart.discount;
      cartCouponId = cart.coupon as mongoose.Types.ObjectId;
    }

    const productIds = [
      ...new Set(
        cart.items.map((item: { product: unknown }) => String(item.product)),
      ),
    ];
    const products = await orderRepository.findProductsByIds(productIds);
    const productMap = new Map(products.map((p) => [String(p._id), p]));

    // Always price order lines from live catalog + active sales.
    const pricedLines = await buildOrderItemsFromProductsWithSalePricing(
      cart.items,
      productMap,
    );
    const checkoutItems = cart.items.map((item, idx) => ({
      ...item,
      price: pricedLines[idx]?.price ?? item.price,
    }));
    const checkoutSubtotal = checkoutItems.reduce(
      (sum, item) => sum + Number(item.price) * Number(item.quantity),
      0,
    );

    return {
      checkoutItems,
      checkoutSubtotal,
      productMap,
      cartIdToDelete,
      cartCouponId,
      cartCouponDiscount,
      cartPromotionDiscount,
      cartPromotionId,
    };
  },

  async evaluateCoupon(
    userId: string,
    checkoutSubtotal: number,
    couponCode?: string,
    cartCouponId?: mongoose.Types.ObjectId,
    cartCouponDiscount?: number,
    lines?: import("./coupon/couponBusinessRules").CouponLineScope[],
  ) {
    return couponValidationService.evaluateCouponForOrder(
      userId,
      checkoutSubtotal,
      couponCode,
      cartCouponId,
      cartCouponDiscount,
      lines,
    );
  },

  async validateAndBuildItems(
    checkoutItems: any[],
    productMap: Map<string, any>,
  ) {
    for (const item of checkoutItems) {
      const product = productMap.get(String(item.product));
      if (!product || !product.isActive) {
        throw new AppError(`Product is no longer available.`, 400);
      }
      const minQty = getGiftMinQty(product);
      if (item.quantity < minQty) {
        throw new AppError(
          `Minimum quantity for "${product.name}" is ${minQty}.`,
          400,
        );
      }
      const variant = findVariantBySku(product, item.variant?.sku);
      if (!variant) {
        throw new AppError(
          `Selected variant for "${product.name}" is no longer available.`,
          400,
        );
      }
      if (variant.stock < item.quantity) {
        throw new AppError(`Insufficient stock for "${product.name}".`, 409);
      }
    }

    return buildOrderItemsFromProductsWithSalePricing(checkoutItems, productMap);
  },

  async createRazorpayIntent(userId: string, intentData: any) {
    const {
      total,
      checkoutItems,
      orderItems,
      shippingAddress,
      checkoutSubtotal,
      discount,
      saleDiscount,
      promotionDiscount,
      couponDiscount,
      promotionId,
      shopSessionKey,
      shippingCharge,
      codFee,
      tax,
      couponId,
      notes,
      cartIdToDelete,
      marketingAttribution,
    } = intentData;

    const intentId = new mongoose.Types.ObjectId();
    const razorpayOrder = await createRazorpayOrder({
      amount: total,
      receipt: `CI_${intentId.toHexString()}`,
      notes: { checkoutIntentId: String(intentId) },
    });

    const stockLines = checkoutItems.map((item: any) => ({
      productId: String(item.product),
      sku: item.variant.sku,
      quantity: item.quantity,
    }));

    await CheckoutPaymentIntent.create({
      _id: intentId,
      user: userId,
      razorpayOrderId: razorpayOrder.id,
      expiresAt: new Date(Date.now() + 48 * 60 * 60 * 1000),
      snapshot: {
        shippingAddress,
        items: orderItems as CheckoutIntentSnapshotItem[],
        stockLines,
        subtotal: checkoutSubtotal,
        discount,
        saleDiscount: saleDiscount ?? 0,
        promotionDiscount: promotionDiscount ?? 0,
        couponDiscount: couponDiscount ?? 0,
        ...(promotionId ? { promotion: promotionId } : {}),
        ...(shopSessionKey ? { shopSessionKey } : {}),
        shippingCharge,
        codFee,
        tax,
        total,
        coupon: couponId,
        notes,
        cartIdToDelete: cartIdToDelete ?? undefined,
        ...(marketingAttribution ? { marketingAttribution } : {}),
      },
    });

    return { intentId: String(intentId), razorpayOrder };
  },

  async createCodOrder(
    orderPayload: any,
    checkoutItems: any[],
    cartIdToDelete: mongoose.Types.ObjectId | null,
    couponId: mongoose.Types.ObjectId | undefined,
  ) {
    let codOrder: InstanceType<typeof Order> | undefined;

    await withOptionalTransaction(async (session) => {
      const created = await Order.create([orderPayload], sessionOpts(session));
      codOrder = created[0] as InstanceType<typeof Order>;

      for (const item of checkoutItems) {
        const ok = await decrementVariantStock(
          String(item.product),
          item.variant.sku,
          item.quantity,
          sessionOpts(session),
        );
        if (!ok) {
          throw new AppError(
            `Insufficient stock for a cart item. Please refresh and try again.`,
            409,
          );
        }
      }

      if (couponId && codOrder) {
        await couponRedemptionService.redeemOrThrowInTransaction(
          session,
          orderPayload.user as mongoose.Types.ObjectId,
          couponId,
          orderPayload.subtotal,
          {
            sourceType: "order",
            sourceId: codOrder._id as mongoose.Types.ObjectId,
          },
        );
      }

      if (cartIdToDelete) {
        if (session) {
          await orderRepository.deleteCartByIdInSession(
            cartIdToDelete,
            session,
          );
        } else {
          await orderRepository.deleteCartById(cartIdToDelete);
        }
      }
    }, "createCodOrder");

    if (cartIdToDelete && codOrder) {
      const uid = String(orderPayload.user);
      await cartService.clearCartCache(uid);
      emitCartEvent({ type: "cart.cleared", userId: uid });
    }

    return codOrder;
  },
};
