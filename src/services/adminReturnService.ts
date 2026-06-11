import mongoose, { ClientSession } from "mongoose";
import { Request } from "express";
import Order from "../models/Order";
import AppError from "../types/utils/AppError";
import { writeAdminAudit } from "./adminAuditService";
import logger from "../types/utils/logger";

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
    if (
      msg.includes("Transaction numbers are only allowed") ||
      msg.includes("not a repl set") ||
      msg.includes("replica set")
    ) {
      logger.warn(
        "[adminReturnService] Mongo transactions unavailable — running without transaction",
      );
      return fn(null);
    }
    throw err;
  } finally {
    if (session) await session.endSession();
  }
}

// ─── resolveReturn ────────────────────────────────────────────────────────────

export interface ResolveReturnResult {
  order: InstanceType<typeof Order>;
  newStatus: "approved" | "rejected";
}

/**
 * Approve or reject a return request.
 * Wrapped in a Mongo transaction (graceful degradation on standalone mongod).
 */
export async function resolveReturn(
  req: Request,
  orderId: string,
  action: "approve" | "reject",
  adminNote?: string,
): Promise<ResolveReturnResult> {
  const newStatus = action === "approve" ? "approved" : "rejected";

  return withOptionalTransaction(async (session) => {
    const order = await Order.findById(orderId)
      .populate("user", "name email")
      .session(session);

    if (!order) throw new AppError("Order not found", 404);
    if (order.returnStatus !== "requested") {
      throw new AppError(
        "Only orders with requested return status can be resolved",
        400,
      );
    }

    order.returnStatus = newStatus;
    if (order.returnRequest) {
      order.returnRequest.resolvedAt = new Date();
      order.returnRequest.adminNote = adminNote?.trim();
    }

    if (action === "approve") {
      order.statusHistory.push({
        status: "return_approved",
        timestamp: new Date(),
        note: adminNote,
      } as never);
    }

    if (session) {
      await order.save({ session });
    } else {
      await order.save();
    }

    // Audit (non-critical — best effort)
    await writeAdminAudit(
      req,
      `order.return_${newStatus}` as string,
      { orderId: order._id, adminNote },
      orderId,
    );

    return { order, newStatus };
  });
}
