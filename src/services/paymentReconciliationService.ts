import Order from "../models/Order";
import CheckoutPaymentIntent from "../models/CheckoutPaymentIntent";
import AppError from "../types/utils/AppError";
import logger from "../types/utils/logger";
import { securityLog } from "../types/utils/securityLog";
import { razorpayInstance } from "./razorpay";
import {
  paymentVerificationService,
  PaymentVerifiedOrderDto,
} from "./paymentVerificationService";
import {
  acquirePaymentVerifyLock,
  releasePaymentVerifyLock,
  tryClaimPaymentPlacedNotification,
} from "./checkoutConcurrency";
import { enqueueOrderEvent } from "../queues/orderQueue";
import { OrderEventType } from "../events/orderEvents";
import {
  CHECKOUT_INTENT_VERIFY_SELECT,
  ORDER_PAYMENT_RESPONSE_SELECT,
  PAYMENT_QUERY_MAX_MS,
} from "../constants/paymentQuery";
import { toOrderPaymentDto } from "../types/utils/orderPaymentDto";

interface RazorpayPaymentEntity {
  id: string;
  order_id: string | null;
  status: string;
}

export type ReconcileResult =
  | { status: "already_paid"; order: PaymentVerifiedOrderDto }
  | { status: "reconciled"; order: PaymentVerifiedOrderDto }
  | { status: "skipped"; reason: string };

async function sendReconciledPaidEvent(
  order: PaymentVerifiedOrderDto,
  razorpayPaymentId: string,
) {
  const notifyOnce = await tryClaimPaymentPlacedNotification(razorpayPaymentId);
  if (!notifyOnce) return;

  const orderId = String(order._id);
  await enqueueOrderEvent({
    eventType: OrderEventType.ORDER_PAID,
    orderId,
    orderNumber: String(order.orderNumber ?? ""),
    userId: String(order.user),
    total: Number(order.total ?? 0),
    paymentMethod: "razorpay",
    razorpayPaymentId,
    ip: "webhook",
    userAgent: "razorpay-webhook",
  });
}

/**
 * Server-side reconciliation when the client never called verify-payment
 * (webhook or recovery cron).
 */
export const paymentReconciliationService = {
  async reconcileCapturedPayment(
    razorpayOrderId: string,
    razorpayPaymentId: string,
    source: "webhook" | "recovery",
  ): Promise<ReconcileResult> {
    const payment = (await razorpayInstance.payments.fetch(
      razorpayPaymentId,
    )) as unknown as RazorpayPaymentEntity;
    if (!payment.order_id || payment.order_id !== razorpayOrderId) {
      return { status: "skipped", reason: "payment_order_mismatch" };
    }
    const okStatus =
      payment.status === "captured" || payment.status === "authorized";
    if (!okStatus) {
      return { status: "skipped", reason: `payment_status_${payment.status}` };
    }

    const paidOrder = await Order.findOne({
      razorpayPaymentId,
      paymentStatus: "paid",
    })
      .select(ORDER_PAYMENT_RESPONSE_SELECT)
      .lean()
      .maxTimeMS(PAYMENT_QUERY_MAX_MS);
    if (paidOrder) {
      return {
        status: "already_paid",
        order: toOrderPaymentDto(paidOrder as Record<string, unknown>),
      };
    }

    const intent = await CheckoutPaymentIntent.findOne({ razorpayOrderId })
      .select(CHECKOUT_INTENT_VERIFY_SELECT)
      .lean()
      .maxTimeMS(PAYMENT_QUERY_MAX_MS);

    if (intent) {
      const userId = String(intent.user);
      const lockKey = `intent:${intent._id}`;
      const gotLock = await acquirePaymentVerifyLock(lockKey);
      if (!gotLock) {
        return { status: "skipped", reason: "verify_lock_busy" };
      }

      try {
        if (intent.createdOrderId) {
          const replay = await Order.findOne({
            _id: intent.createdOrderId,
            user: userId,
            paymentStatus: "paid",
          })
            .select(ORDER_PAYMENT_RESPONSE_SELECT)
            .lean()
            .maxTimeMS(PAYMENT_QUERY_MAX_MS);
          if (replay) {
            const dto = toOrderPaymentDto(replay as Record<string, unknown>);
            await sendReconciledPaidEvent(dto, razorpayPaymentId);
            return { status: "already_paid", order: dto };
          }
        }

        const expectedTotal = (intent as { snapshot?: { total?: number } })
          .snapshot?.total;
        if (typeof expectedTotal !== "number") {
          return { status: "skipped", reason: "intent_total_missing" };
        }

        await paymentVerificationService.assertRazorpayGatewayPaymentForTotal(
          razorpayOrderId,
          razorpayPaymentId,
          expectedTotal,
        );

        const intentDoc = await CheckoutPaymentIntent.findById(intent._id);
        if (!intentDoc) {
          return { status: "skipped", reason: "intent_not_found" };
        }

        const orderDto = await paymentVerificationService.finalizePaymentIntent(
          intentDoc,
          userId,
          razorpayOrderId,
          razorpayPaymentId,
          "webhook-reconciled",
        );

        if (!orderDto) {
          return { status: "skipped", reason: "finalize_no_order" };
        }

        await sendReconciledPaidEvent(orderDto, razorpayPaymentId);
        securityLog("payment.webhook_reconciled", {
          orderId: String(orderDto._id),
          source,
        });
        logger.info(
          `Payment reconciled (${source}) intent=${String(intent._id)} payment=${razorpayPaymentId}`,
        );
        return { status: "reconciled", order: orderDto };
      } finally {
        await releasePaymentVerifyLock(lockKey);
      }
    }

    const pendingOrder = await Order.findOne({
      razorpayOrderId,
      paymentMethod: "razorpay",
      paymentStatus: { $ne: "paid" },
    })
      .select("_id user total razorpayOrderId paymentStatus")
      .lean()
      .maxTimeMS(PAYMENT_QUERY_MAX_MS);

    if (!pendingOrder) {
      return { status: "skipped", reason: "no_matching_checkout" };
    }

    const userId = String(pendingOrder.user);
    const lockKey = String(pendingOrder._id);
    const gotLock = await acquirePaymentVerifyLock(lockKey);
    if (!gotLock) {
      return { status: "skipped", reason: "verify_lock_busy" };
    }

    try {
      await paymentVerificationService.assertRazorpayGatewayPaymentForTotal(
        razorpayOrderId,
        razorpayPaymentId,
        Number(pendingOrder.total),
      );

      const orderDto =
        await paymentVerificationService.finalizeDirectOrderVerification(
          String(pendingOrder._id),
          userId,
          razorpayOrderId,
          razorpayPaymentId,
          "webhook-reconciled",
        );

      if (!orderDto) {
        return { status: "skipped", reason: "finalize_no_order" };
      }

      await sendReconciledPaidEvent(orderDto, razorpayPaymentId);
      securityLog("payment.recovery_reconciled", {
        orderId: String(orderDto._id),
        source,
      });
      return { status: "reconciled", order: orderDto };
    } catch (err) {
      if (err instanceof AppError) {
        logger.warn(`Reconcile skipped (${source}): ${err.message}`);
        return { status: "skipped", reason: err.message };
      }
      throw err;
    } finally {
      await releasePaymentVerifyLock(lockKey);
    }
  },
};
