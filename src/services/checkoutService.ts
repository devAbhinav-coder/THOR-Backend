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
  buildOrderItemsFromProducts,
} from "./orderService";
import { cartService } from "./cartService";
import { emitCartEvent } from "./cart/cartEventService";
import { cartRevalidationService } from "./cart/cartRevalidationService";
import { createRazorpayOrder } from "./razorpay";
import { decrementVariantStock } from "./inventoryService";
import type { CheckoutIntentSnapshotItem } from "../models/CheckoutPaymentIntent";
import {
  sessionOpts,
  withOptionalTransaction,
} from "../types/utils/mongoTransaction";

export const checkoutService = {
  async processBuyNowItem(buyNowItem: any) {
    const product = await Product.findById(buyNowItem.productId);
    if (!product || !product.isActive) {
      throw new AppError("Product is no longer available.", 400);
    }
    const minQty = getGiftMinQty(product);
    if (buyNowItem.quantity < minQty) {
      throw new AppError(
        `Minimum quantity for "${product.name}" is ${minQty}.`,
        400,
      );
    }
    const variant = product.variants.find(
      (v) => v.sku === buyNowItem.variant.sku,
    );
    if (!variant || variant.stock < buyNowItem.quantity) {
      throw new AppError(`Insufficient stock for "${product.name}".`, 400);
    }

    const linePrice = Number(variant.price ?? product.price ?? 0);
    const checkoutItems = [
      {
        product: product._id as mongoose.Types.ObjectId,
        variant: buyNowItem.variant,
        quantity: buyNowItem.quantity,
        price: linePrice,
        customFieldAnswers: buyNowItem.customFieldAnswers,
      },
    ];
    const checkoutSubtotal = linePrice * buyNowItem.quantity;
    const productMap = new Map([[String(product._id), product]]);

    return {
      checkoutItems,
      checkoutSubtotal,
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

    const checkoutItems = cart.items;
    const checkoutSubtotal = cart.subtotal;
    const cartIdToDelete = cart._id as mongoose.Types.ObjectId;

    let cartCouponDiscount = 0;
    let cartCouponId: mongoose.Types.ObjectId | undefined;
    if (cart.coupon) {
      cartCouponDiscount = cart.discount;
      cartCouponId = cart.coupon as mongoose.Types.ObjectId;
    }

    const productIds = [
      ...new Set(
        cart.items.map((item: { product: unknown }) => String(item.product)),
      ),
    ];
    const products = await orderRepository.findProductsByIds(productIds);    const productMap = new Map(products.map((p) => [String(p._id), p]));

    return {
      checkoutItems,
      checkoutSubtotal,
      productMap,
      cartIdToDelete,
      cartCouponId,
      cartCouponDiscount,
    };
  },

  async evaluateCoupon(
    userId: string,
    checkoutSubtotal: number,
    couponCode?: string,
    cartCouponId?: mongoose.Types.ObjectId,
    cartCouponDiscount?: number,
  ) {
    return couponValidationService.evaluateCouponForOrder(
      userId,
      checkoutSubtotal,
      couponCode,
      cartCouponId,
      cartCouponDiscount,
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
      const variant = product.variants.find(
        (v: any) => v.sku === item.variant.sku,
      );
      if (!variant || variant.stock < item.quantity) {
        throw new AppError(`Insufficient stock for "${product.name}".`, 400);
      }
    }

    return buildOrderItemsFromProducts(checkoutItems, productMap);
  },

  async createRazorpayIntent(userId: string, intentData: any) {
    const {
      total,
      checkoutItems,
      orderItems,
      shippingAddress,
      checkoutSubtotal,
      discount,
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
