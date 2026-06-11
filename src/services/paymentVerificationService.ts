import mongoose, { ClientSession } from "mongoose";
import Order from "../models/Order";
import CheckoutPaymentIntent from "../models/CheckoutPaymentIntent";
import { couponRedemptionService } from "./coupon/couponRedemptionService";
import AppError from "../types/utils/AppError";
import logger from "../types/utils/logger";
import {
  verifyPaymentAndThrow,
  assertRazorpayPaymentMatchesOrder,
} from "./razorpay";
import { decrementVariantStock } from "./inventoryService";
import { orderRepository } from "../repositories/orderRepository";
import {
  ORDER_PAYMENT_RESPONSE_SELECT,
  PAYMENT_QUERY_MAX_MS,
} from "../constants/paymentQuery";
import { toOrderPaymentDto } from "../types/utils/orderPaymentDto";
import { orderReadService } from "./orderReadService";
import { cartService } from "./cartService";
import { emitCartEvent } from "./cart/cartEventService";
import {
  sessionOpts,
  withOptionalTransaction,
  withQuerySession,
} from "../types/utils/mongoTransaction";

export type PaymentVerifiedOrderDto = Record<string, unknown>;

async function loadVerifiedOrderDto(
  orderId: mongoose.Types.ObjectId | string,
  userId: string,
): Promise<PaymentVerifiedOrderDto | null> {
  const order = await Order.findOne({ _id: orderId, user: userId })
    .select(ORDER_PAYMENT_RESPONSE_SELECT)
    .lean()
    .maxTimeMS(PAYMENT_QUERY_MAX_MS);
  if (!order) return null;
  await orderReadService.invalidateUserOrderCache(userId, String(orderId));
  return toOrderPaymentDto(order as Record<string, unknown>);
}

export const paymentVerificationService = {
  async verifyRazorpayGatewayForTotal(
    razorpayOrderId: string,
    razorpayPaymentId: string,
    razorpaySignature: string,
    expectedOrderTotalRupees: number,
  ): Promise<void> {
    verifyPaymentAndThrow(
      razorpayOrderId,
      razorpayPaymentId,
      razorpaySignature,
    );
    await assertRazorpayPaymentMatchesOrder(
      razorpayOrderId,
      razorpayPaymentId,
      expectedOrderTotalRupees,
    );
  },

  /** Webhook / recovery: API truth only (no client HMAC). */
  async assertRazorpayGatewayPaymentForTotal(
    razorpayOrderId: string,
    razorpayPaymentId: string,
    expectedOrderTotalRupees: number,
  ): Promise<void> {
    await assertRazorpayPaymentMatchesOrder(
      razorpayOrderId,
      razorpayPaymentId,
      expectedOrderTotalRupees,
    );
  },

  async applyCouponUsageIncrementIfValid(
    session: ClientSession | null,
    userId: mongoose.Types.ObjectId,
    couponRef: mongoose.Types.ObjectId | undefined | null,
    subtotal: number,
    logCtx: string,
    source: {
      sourceType: "order" | "checkout_intent";
      sourceId: mongoose.Types.ObjectId;
    },
  ): Promise<void> {
    if (!couponRef) return;
    const ok = await couponRedemptionService.redeemInTransaction(
      session,
      userId,
      couponRef,
      subtotal,
      source,
      logCtx,
    );
    if (!ok) {
      logger.warn(`verifyPayment: coupon redeem skipped ${logCtx}`);
    }
  },

  async finalizePaymentIntent(
    intent: InstanceType<typeof CheckoutPaymentIntent>,
    userId: string,
    razorpayOrderId: string,
    razorpayPaymentId: string,
    razorpaySignature: string,
  ): Promise<PaymentVerifiedOrderDto | null> {
    let resolvedOrderId: mongoose.Types.ObjectId | undefined;
    let cartWasDeleted = false;

    await withOptionalTransaction(async (session) => {
      const existingForRz = await withQuerySession(
        Order.findOne({ razorpayOrderId }),
        session,
      );
      if (existingForRz) {
        if (
          String(existingForRz.user) !== userId ||
          existingForRz.paymentStatus !== "paid"
        ) {
          throw new AppError(
            "Payment could not be linked to your account.",
            400,
          );
        }
        resolvedOrderId = existingForRz._id as mongoose.Types.ObjectId;
        await CheckoutPaymentIntent.updateOne(
          { _id: intent._id },
          {
            $set: { consumedAt: new Date(), createdOrderId: existingForRz._id },
          },
          sessionOpts(session),
        );
        return;
      }

      const claimedIntent = await CheckoutPaymentIntent.findOneAndUpdate(
        { _id: intent._id, consumedAt: null },
        { $set: { consumedAt: new Date() } },
        { ...sessionOpts(session), new: true },
      );

      if (!claimedIntent) {
        const peer = await withQuerySession(
          CheckoutPaymentIntent.findById(intent._id),
          session,
        );
        if (!peer) throw new AppError("Checkout session not found.", 404);
        if (peer.createdOrderId) {
          resolvedOrderId = peer.createdOrderId;
          return;
        }
        if (peer.consumedAt && !peer.createdOrderId) {
          throw new AppError(
            "Checkout is in an inconsistent state. Please contact support with your payment ID.",
            409,
          );
        }
        throw new AppError(
          "Could not finalize checkout. Please retry or contact support.",
          409,
        );
      }
      if (claimedIntent.expiresAt < new Date()) {
        throw new AppError(
          "Checkout session expired. Please return to your cart and try again.",
          400,
        );
      }

      const snap = claimedIntent.snapshot;
      const orderPayload = {
        user: new mongoose.Types.ObjectId(userId),
        items: snap.items,
        shippingAddress: snap.shippingAddress,
        paymentMethod: "razorpay" as const,
        subtotal: snap.subtotal,
        discount: snap.discount,
        shippingCharge: snap.shippingCharge,
        codFee: snap.codFee,
        tax: snap.tax,
        total: snap.total,
        coupon: snap.coupon,
        notes: snap.notes,
        paymentStatus: "paid" as const,
        status: "confirmed" as const,
        razorpayOrderId,
        razorpayPaymentId,
        razorpaySignature,
        invoice: { isGenerated: true, generatedAt: new Date() },
        inventoryReserved: true,
      };

      const createdArr = await Order.create(
        [orderPayload],
        sessionOpts(session),
      );
      const newOrder = createdArr[0] as InstanceType<typeof Order>;
      resolvedOrderId = newOrder._id as mongoose.Types.ObjectId;

      for (const line of snap.stockLines) {
        const ok = await decrementVariantStock(
          line.productId as string,
          line.sku,
          line.quantity,
          sessionOpts(session),
        );
        if (!ok) {
          logger.error(
            `verifyPayment intent: insufficient stock rz=${razorpayOrderId} sku=${line.sku}`,
          );
          throw new AppError(
            "Inventory changed before we could confirm your payment. Please contact support with your payment ID.",
            409,
          );
        }
      }

      await this.applyCouponUsageIncrementIfValid(
        session,
        new mongoose.Types.ObjectId(userId),
        snap.coupon as mongoose.Types.ObjectId,
        snap.subtotal,
        `intent=${String(intent._id)}`,
        {
          sourceType: "order",
          sourceId: newOrder._id as mongoose.Types.ObjectId,
        },
      );

      if (snap.cartIdToDelete) {
        cartWasDeleted = true;
        if (session) {
          await orderRepository.deleteCartByIdInSession(
            snap.cartIdToDelete as mongoose.Types.ObjectId,
            session,
          );
        } else {
          await orderRepository.deleteCartById(
            snap.cartIdToDelete as mongoose.Types.ObjectId,
          );
        }
      }

      const linkIntent = await CheckoutPaymentIntent.updateOne(
        { _id: intent._id, createdOrderId: null },
        { $set: { createdOrderId: newOrder._id } },
        sessionOpts(session),
      );

      if (linkIntent.modifiedCount !== 1) {
        throw new AppError(
          "Could not finalize checkout. Please retry or contact support.",
          409,
        );
      }
    }, "finalizePaymentIntent");

    if (cartWasDeleted) {
      await cartService.clearCartCache(userId);
      emitCartEvent({ type: "cart.cleared", userId });
    }

    if (!resolvedOrderId) {
      const intentReload = await CheckoutPaymentIntent.findById(intent._id)
        .select("createdOrderId")
        .lean()
        .maxTimeMS(PAYMENT_QUERY_MAX_MS);
      resolvedOrderId = intentReload?.createdOrderId;
    }

    if (!resolvedOrderId) return null;
    return loadVerifiedOrderDto(resolvedOrderId, userId);
  },

  async finalizeDirectOrderVerification(
    orderId: string,
    userId: string,
    razorpayOrderId: string,
    razorpayPaymentId: string,
    razorpaySignature: string,
  ): Promise<PaymentVerifiedOrderDto | null> {
    await withOptionalTransaction(async (session) => {
      const fresh = await withQuerySession(Order.findById(orderId), session);
      if (!fresh || String(fresh.user) !== userId) {
        throw new AppError("Order not found.", 404);
      }
      if (fresh.paymentStatus === "paid") return;

      for (const item of fresh.items) {
        const ok = await decrementVariantStock(
          String(item.product),
          item.variant.sku,
          item.quantity,
          sessionOpts(session),
        );
        if (!ok) {
          logger.error(
            `verifyPayment: insufficient stock after Razorpay success order=${orderId} sku=${item.variant.sku}`,
          );
          throw new AppError(
            "Inventory changed before we could confirm your payment. Please contact support with your payment ID.",
            409,
          );
        }
      }

      await this.applyCouponUsageIncrementIfValid(
        session,
        new mongoose.Types.ObjectId(userId),
        fresh.coupon as mongoose.Types.ObjectId,
        fresh.subtotal,
        `order=${orderId}`,
        { sourceType: "order", sourceId: fresh._id as mongoose.Types.ObjectId },
      );

      fresh.paymentStatus = "paid";
      fresh.status = "confirmed";
      fresh.razorpayPaymentId = razorpayPaymentId;
      fresh.razorpaySignature = razorpaySignature;
      fresh.inventoryReserved = true;
      fresh.invoice = { isGenerated: true, generatedAt: new Date() };
      fresh.statusHistory.push({
        status: "confirmed",
        timestamp: new Date(),
        note: "Payment received (Invoice auto-generated)",
      });
      await fresh.save(sessionOpts(session));
    }, "finalizeDirectOrderVerification");

    return loadVerifiedOrderDto(orderId, userId);
  },
};
