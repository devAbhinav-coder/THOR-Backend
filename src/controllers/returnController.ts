import { Response } from "express";
import { AuthRequest } from "../types";
import catchAsync from "../types/utils/catchAsync";
import AppError from "../types/utils/AppError";
import { sendSuccess } from "../types/utils/response";
import Order from "../models/Order";
import { enqueueOrderEvent } from "../queues/orderQueue";
import { OrderEventType } from "../events/orderEvents";

export const requestReturn = catchAsync(
  async (req: AuthRequest, res: Response) => {
    const { id } = req.params;
    const { reason, note, refundMethod, userBankDetails } = req.body;

    if (!reason || reason.trim() === "") {
      throw new AppError("Reason is required for returning an order", 400);
    }

    const order = await Order.findOne({
      _id: id,
      user: req.user?._id,
    }).populate("user");
    if (!order) {
      throw new AppError("Order not found", 404);
    }

    if (order.status !== "delivered") {
      throw new AppError("Only delivered orders can be returned", 400);
    }

    if (order.returnStatus && order.returnStatus !== "none") {
      throw new AppError("Return request already active or processed", 400);
    }

    if (!order.deliveredAt) {
      throw new AppError(
        "Delivery date is not recorded for this order. Please contact support.",
        400,
      );
    }

    const daysSinceDelivery =
      (Date.now() - new Date(order.deliveredAt).getTime()) /
      (1000 * 60 * 60 * 24);
    if (daysSinceDelivery > 7) {
      throw new AppError("Return window of 7 days has expired", 400);
    }

    let finalRefundMethod:
      | "original_payment"
      | "upi"
      | "bank_transfer"
      | undefined;
    if (order.paymentMethod === "razorpay") {
      finalRefundMethod = "original_payment";
    } else if (order.paymentMethod === "cod") {
      if (!refundMethod || !["upi", "bank_transfer"].includes(refundMethod)) {
        throw new AppError(
          "Valid refund method (upi or bank_transfer) is required for COD orders",
          400,
        );
      }
      finalRefundMethod = refundMethod;
      if (finalRefundMethod === "upi" && !userBankDetails?.upiId) {
        throw new AppError("UPI ID is required for UPI refund method", 400);
      }
      if (
        finalRefundMethod === "bank_transfer" &&
        (!userBankDetails?.accountNumber ||
          !userBankDetails?.ifscCode ||
          !userBankDetails?.accountName)
      ) {
        throw new AppError(
          "Account Name, Account Number and IFSC Code are required for Bank Transfer refund",
          400,
        );
      }
    }

    order.returnStatus = "requested";
    order.returnRequest = {
      reason: reason.trim(),
      note: note?.trim(),
      refundMethod: finalRefundMethod,
      userBankDetails:
        finalRefundMethod === "original_payment" ? undefined : userBankDetails,
      requestedAt: new Date(),
    };

    await order.save();

    const populatedUser = order.user as unknown as {
      name: string;
      email: string;
    };
    const userName = populatedUser?.name || "Customer";
    const userEmail = populatedUser?.email || "";

    // Delegate side-effects
    await enqueueOrderEvent({
      eventType: OrderEventType.RETURN_REQUESTED,
      orderId: String(order._id),
      orderNumber: order.orderNumber,
      userId: String(req.user!._id),
      userName,
      userEmail,
      total: order.total,
      returnReason: order.returnRequest.reason,
      refundMethod: finalRefundMethod,
      paymentMethod: order.paymentMethod,
    });

    sendSuccess(res, { order }, "Return requested successfully");
  },
);
