import Order from "../models/Order";
import CheckoutPaymentIntent from "../models/CheckoutPaymentIntent";
import logger from "../types/utils/logger";
import { razorpayInstance } from "./razorpay";
import { paymentReconciliationService } from "./paymentReconciliationService";
import { PAYMENT_QUERY_MAX_MS } from "../constants/paymentQuery";

interface RazorpayPaymentListItem {
  id: string;
  status: string;
}

const RECOVERY_BATCH = 25;
const MIN_AGE_MS = 15 * 60 * 1000;

/**
 * Finds Razorpay checkouts that may be paid at the gateway but still pending locally.
 */
export async function runPaymentRecoveryJob(): Promise<void> {
  const cutoff = new Date(Date.now() - MIN_AGE_MS);

  const pendingOrders = await Order.find({
    paymentMethod: "razorpay",
    paymentStatus: "pending",
    razorpayOrderId: { $exists: true, $ne: "" },
    updatedAt: { $lt: cutoff },
  })
    .select("_id razorpayOrderId")
    .limit(RECOVERY_BATCH)
    .lean()
    .maxTimeMS(PAYMENT_QUERY_MAX_MS);

  for (const row of pendingOrders) {
    const rzOrderId = row.razorpayOrderId as string;
    try {
      const payments = (await razorpayInstance.orders.fetchPayments(
        rzOrderId,
      )) as {
        items?: RazorpayPaymentListItem[];
      };
      const captured = (payments.items ?? []).find(
        (p) => p.status === "captured" || p.status === "authorized",
      );
      if (!captured) continue;

      await paymentReconciliationService.reconcileCapturedPayment(
        rzOrderId,
        captured.id,
        "recovery",
      );
    } catch (e) {
      logger.warn(
        `Payment recovery order=${String(row._id)}: ${(e as Error).message}`,
      );
    }
  }

  const staleIntents = await CheckoutPaymentIntent.find({
    consumedAt: null,
    expiresAt: { $gt: new Date() },
    createdAt: { $lt: cutoff },
  })
    .select("_id razorpayOrderId")
    .limit(RECOVERY_BATCH)
    .lean()
    .maxTimeMS(PAYMENT_QUERY_MAX_MS);

  for (const intent of staleIntents) {
    try {
      const payments = (await razorpayInstance.orders.fetchPayments(
        intent.razorpayOrderId,
      )) as {
        items?: RazorpayPaymentListItem[];
      };
      const captured = (payments.items ?? []).find(
        (p) => p.status === "captured" || p.status === "authorized",
      );
      if (!captured) continue;

      await paymentReconciliationService.reconcileCapturedPayment(
        intent.razorpayOrderId,
        captured.id,
        "recovery",
      );
    } catch (e) {
      logger.warn(
        `Payment recovery intent=${String(intent._id)}: ${(e as Error).message}`,
      );
    }
  }
}
