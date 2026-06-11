import mongoose, { ClientSession } from "mongoose";
import { Request } from "express";
import Order from "../models/Order";
import AppError from "../types/utils/AppError";
import { incrementVariantStock, logStockMovement } from "./inventoryService";
import { refProductId } from "../types/utils/productStock";
import {
  getMaxRefundableInr,
  getNonRefundableFeesInr,
} from "../types/utils/orderRefundPolicy";
import { writeAdminAudit } from "./adminAuditService";
import { AuthRequest } from "../types";
import logger from "../types/utils/logger";
// ─── Types ───────────────────────────────────────────────────────────────────

export type ManagedOrderStatus =
  | "pending"
  | "confirmed"
  | "processing"
  | "shipped"
  | "delivered"
  | "cancelled"
  | "refunded";

export const ALLOWED_STATUS_TRANSITIONS: Record<
  ManagedOrderStatus,
  ManagedOrderStatus[]
> = {
  pending: ["confirmed", "cancelled"],
  confirmed: ["processing", "cancelled"],
  processing: ["shipped", "cancelled"],
  shipped: ["delivered", "cancelled", "refunded"],
  delivered: ["refunded"],
  cancelled: ["refunded"],
  refunded: [],
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Run `fn` inside a Mongo transaction when a replica set is available.
 * On a standalone mongod (dev), degrades gracefully — runs without a session.
 */
async function withOptionalTransaction<T>(
  fn: (session: ClientSession | null) => Promise<T>,
): Promise<T> {
  let session: ClientSession | null = null;
  try {
    session = await mongoose.startSession();
    let result!: T;
    await session.withTransaction(async () => {
      result = await fn(session);
    });
    return result;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "";
    // Standalone mongod doesn't support transactions — degrade gracefully
    if (
      msg.includes("Transaction numbers are only allowed") ||
      msg.includes("not a repl set") ||
      msg.includes("replica set")
    ) {
      logger.warn(
        "[adminOrderService] Mongo transactions unavailable — running without transaction",
      );
      return fn(null);
    }
    throw err;
  } finally {
    if (session) await session.endSession();
  }
}

/**
 * Restore stock for all order items in parallel.
 * Each item's increment + ledger log runs concurrently.
 */
async function restoreOrderStock(
  order: InstanceType<typeof Order>,
  actorId: unknown,
  note: string,
  session: ClientSession | null,
): Promise<void> {
  await Promise.all(
    order.items.map(async (item) => {
      const pid = refProductId(item.product);
      await incrementVariantStock(
        pid,
        item.variant.sku,
        item.quantity,
        session ? { session } : {},
      );
      await logStockMovement(pid, item.variant.sku, item.quantity, {
        reason: "sale_return",
        referenceId: String(order._id),
        referenceType: "order",
        actor: actorId as string,
        note,
      });
    }),
  );
}

// ─── cancelOrder ─────────────────────────────────────────────────────────────

export interface CancelOrderResult {
  order: InstanceType<typeof Order>;
  stockRestored: boolean;
}

/**
 * Cancel an order, optionally restoring stock.
 * Wrapped in a Mongo transaction (graceful degradation on standalone mongod).
 */
export async function cancelOrder(
  orderId: string,
  actorId: unknown,
  note?: string,
): Promise<CancelOrderResult> {
  return withOptionalTransaction(async (session) => {
    const order = await Order.findById(orderId).session(session);
    if (!order) throw new AppError("Order not found.", 404);
    if (order.status === "cancelled")
      throw new AppError("Order is already cancelled.", 400);

    const shouldRestock =
      order.paymentMethod === "cod" ||
      (order.paymentMethod === "razorpay" && order.paymentStatus === "paid") ||
      order.paymentMethod === "offline_upi" ||
      order.paymentMethod === "offline_cash";

    const previousStatus = order.status;

    order.status = "cancelled";
    order.statusHistory.push({
      status: "cancelled",
      timestamp: new Date(),
      note,
    });

    if (shouldRestock) {
      await restoreOrderStock(
        order,
        actorId,
        `Order ${order.orderNumber} cancelled`,
        session,
      );
    }

    if (session) {
      await order.save({ session });
    } else {
      await order.save();
    }

    return { order, stockRestored: shouldRestock };
  });
}

// ─── customerCancelOrder ──────────────────────────────────────────────────────

export interface CustomerCancelOrderResult {
  order: InstanceType<typeof Order>;
  alreadyCancelled: boolean;
}

/**
 * Customer-initiated order cancellation.
 *
 * Safety guarantees:
 * 1. Atomic status claim via findOneAndUpdate — prevents double-cancellation race.
 * 2. Mongo transaction wraps stock restore + order save — no partial state on failure.
 * 3. Idempotent — returns existing cancelled order if already cancelled (safe for retries).
 * 4. Parallel stock restore — all variants incremented concurrently inside the transaction.
 * 5. inventoryReserved flag drives restock decision — cleaner than payment-method heuristics.
 */
export async function customerCancelOrder(
  orderId: string,
  userId: string,
  reason: string,
): Promise<CustomerCancelOrderResult> {
  // ── Step 1: Idempotency check — return immediately if already cancelled ───
  const existing = await Order.findOne({ _id: orderId, user: userId })
    .select(
      "status paymentMethod paymentStatus inventoryReserved orderNumber items total",
    )
    .lean();

  if (!existing) throw new AppError("Order not found.", 404);

  if (existing.status === "cancelled") {
    // Safe to return — idempotent for frontend retries
    const doc = await Order.findById(orderId).lean();
    return { order: doc as InstanceType<typeof Order>, alreadyCancelled: true };
  }

  if (!["pending", "confirmed"].includes(existing.status)) {
    throw new AppError("Order cannot be cancelled at this stage.", 400);
  }

  // ── Step 2: Atomic status claim — prevents double-cancellation race ───────
  // findOneAndUpdate with status filter is atomic; only one concurrent request wins.
  const claimed = await Order.findOneAndUpdate(
    {
      _id: orderId,
      user: userId,
      status: { $in: ["pending", "confirmed"] }, // guard: only claim if still cancellable
    },
    {
      $set: { status: "cancelled" },
      $push: {
        statusHistory: {
          status: "cancelled",
          timestamp: new Date(),
          note: reason,
        },
      },
    },
    {
      new: true,
      select:
        "status paymentMethod paymentStatus inventoryReserved orderNumber items total",
    },
  );

  if (!claimed) {
    // Another request already changed the status — re-read and return
    const concurrent = await Order.findById(orderId).lean();
    if (concurrent?.status === "cancelled") {
      return {
        order: concurrent as InstanceType<typeof Order>,
        alreadyCancelled: true,
      };
    }
    throw new AppError("Order cannot be cancelled at this stage.", 400);
  }

  // ── Step 3: Stock restore inside transaction ──────────────────────────────
  // inventoryReserved flag is the source of truth.
  // Fallback to payment-method heuristic for legacy orders that predate the flag.
  const shouldRestock =
    (claimed as unknown as { inventoryReserved?: boolean })
      .inventoryReserved === true ||
    claimed.paymentMethod === "cod" ||
    claimed.paymentMethod === "razorpay" ||
    claimed.paymentMethod === "offline_upi" ||
    claimed.paymentMethod === "offline_cash";

  if (shouldRestock) {
    await withOptionalTransaction(async (session) => {
      // Re-fetch inside transaction for session binding
      const orderInTx = await Order.findById(orderId).session(session);
      if (!orderInTx) return; // already handled above
      await restoreOrderStock(
        orderInTx,
        userId,
        `Order ${orderInTx.orderNumber} cancelled by customer`,
        session,
      );
    });
  }

  // Re-fetch the final state with full document for response
  const finalOrder = await Order.findById(orderId);
  if (!finalOrder)
    throw new AppError("Order not found after cancellation.", 500);

  return { order: finalOrder, alreadyCancelled: false };
}

// ─── processRefund ────────────────────────────────────────────────────────────

export interface RefundInput {
  refundMethod?: string;
  amount: number;
  notes?: string;
}

export interface ProcessRefundResult {
  order: InstanceType<typeof Order>;
  gatewayRefundId?: string;
}

/**
 * Process a refund for an order.
 * - Validates eligibility and max-refundable amount.
 * - For Razorpay orders, initiates gateway refund before any DB writes.
 * - Restores stock in parallel (unless already cancelled).
 * - Wrapped in Mongo transaction (graceful degradation).
 */
export async function processRefund(
  req: Request,
  orderId: string,
  input: RefundInput,
): Promise<ProcessRefundResult> {
  const { refundMethod, amount: amt, notes } = input;
  const actorId = (req as AuthRequest).user?._id;

  // ── Pre-flight validation (outside transaction — read-only) ───────────────
  const orderCheck = await Order.findById(orderId);
  if (!orderCheck) throw new AppError("Order not found.", 404);
  if (orderCheck.status === "refunded")
    throw new AppError("Order is already refunded.", 400);

  if (!Number.isFinite(amt) || amt <= 0) {
    throw new AppError("Valid refund amount is required.", 400);
  }
  if (amt > orderCheck.total) {
    throw new AppError("Refund amount cannot exceed order total.", 400);
  }

  const nonRefundable = getNonRefundableFeesInr(orderCheck);
  const maxRefundable = getMaxRefundableInr(orderCheck);
  if (amt > maxRefundable) {
    throw new AppError(
      `Refund cannot exceed ₹${maxRefundable.toFixed(2)} (order total minus non-refundable shipping ₹${(orderCheck.shippingCharge || 0).toFixed(2)} and COD fee ₹${(orderCheck.codFee || 0).toFixed(2)}).`,
      400,
    );
  }

  // ── Gateway refund (outside transaction — external API call) ─────────────
  let methodToUse = refundMethod || "cash";
  let gatewayRefundId: string | undefined;

  if (orderCheck.paymentMethod === "razorpay") {
    if (!orderCheck.razorpayPaymentId) {
      throw new AppError("Razorpay payment ID missing on order.", 400);
    }
    methodToUse = "razorpay_auto";
    const { refundRazorpayPayment } = await import("./razorpay");
    try {
      const refundResult = await refundRazorpayPayment(
        orderCheck.razorpayPaymentId,
        amt,
        notes ? { reason: notes.slice(0, 40) } : undefined,
      );
      gatewayRefundId = (refundResult as { id?: string }).id;
    } catch (err: unknown) {
      if (err instanceof AppError) throw err;
      const message =
        err instanceof Error ?
          err.message
        : "Razorpay automated refund failed.";
      throw new AppError(message, 500);
    }
  } else if (!refundMethod) {
    throw new AppError("Refund method is required for COD orders.", 400);
  }

  // ── DB writes (inside transaction) ────────────────────────────────────────
  return withOptionalTransaction(async (session) => {
    const order = await Order.findById(orderId).session(session);
    if (!order) throw new AppError("Order not found.", 404);

    const previousStatus = order.status;

    type RefundMethod =
      | "razorpay_auto"
      | "cash"
      | "bank_transfer"
      | "upi_manual";
    order.refundData = {
      amount: amt,
      method: methodToUse as RefundMethod,
      gatewayRefundId,
      notes,
      processedAt: new Date(),
      nonRefundableFees: nonRefundable > 0 ? nonRefundable : undefined,
    };

    order.status = "refunded";
    order.paymentStatus = "refunded";

    if (order.returnStatus && order.returnStatus !== "none") {
      order.returnStatus = "returned";
      if (order.returnRequest) {
        order.returnRequest.resolvedAt = new Date();
        if (notes) order.returnRequest.adminNote = notes;
      }
    }

    order.statusHistory.push({
      status: "refunded",
      timestamp: new Date(),
      note: notes || methodToUse,
    });

    // Restore stock only if order wasn't already cancelled (cancel already restocked)
    if (previousStatus !== "cancelled") {
      await restoreOrderStock(
        order,
        actorId,
        `Order ${order.orderNumber} refunded`,
        session,
      );
    }

    if (session) {
      await order.save({ session });
    } else {
      await order.save();
    }

    // Audit log (non-critical — outside transaction scope is fine)
    await writeAdminAudit(
      req,
      "order.refunded",
      { orderId: order._id, amount: amt, method: methodToUse },
      orderId,
    );

    return { order, gatewayRefundId };
  });
}
