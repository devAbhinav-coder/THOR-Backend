import { Request, Response, NextFunction } from "express";
import { Types } from "mongoose";
import Order from "../../models/Order";
import User from "../../models/User";
import AppError from "../../types/utils/AppError";
import catchAsync from "../../types/utils/catchAsync";
import { emailTemplates } from "../../services/emailService";
import { enqueueEmail } from "../../queues/emailQueue";
import {
  notifyUser,
  notifyAdmins,
  notifyAdminsEmail,
} from "../../services/notificationService";
import {
  getOrderCancelledByAdminCopy,
  getOrderStatusUpdateCopy,
  getRefundProcessedCopy,
} from "../../services/notifications/orderNotificationCopy";
import { sendPaginated, sendSuccess } from "../../types/utils/response";
import {
  cancelOrder,
  processRefund,
  ALLOWED_STATUS_TRANSITIONS,
  ManagedOrderStatus,
} from "../../services/adminOrderService";
import { AuthRequest } from "../../types";
import logger from "../../types/utils/logger";
import { onOrderDelivered } from "../../services/orderDeliverySideEffects";
import { isCustomerDeliverableEmail } from "../../types/utils/customerEmail";
import { writeAdminAudit } from "../../services/adminAuditService";
import {
  isManualOfflineOrderItem,
} from "../../utils/offlineOrderLine";
import {
  orderChannelMatch,
  type OrderSalesChannelFilter,
} from "../../utils/orderChannel";

// ─── List & Detail ────────────────────────────────────────────────────────────

export const getAllOrders = catchAsync(async (req: Request, res: Response) => {
  const page = Math.max(1, parseInt((req.query.page as string) || "1", 10));
  const limit = Math.min(
    100,
    Math.max(1, parseInt((req.query.limit as string) || "20", 10)),
  );
  const skip = (page - 1) * limit;

  const SORT_MAP: Record<string, string> = {
    newest: "-createdAt",
    oldest: "createdAt",
    value_high: "-total",
    value_low: "total",
    "-createdAt": "-createdAt",
    createdAt: "createdAt",
    "-total": "-total",
    total: "total",
  };
  const sortKey = String(req.query.sort || "newest").trim();
  const mongoSort = SORT_MAP[sortKey] || "-createdAt";

  const ALLOWED_STATUSES = [
    "pending",
    "confirmed",
    "processing",
    "shipped",
    "delivered",
    "cancelled",
    "return_requested",
    "returned",
  ] as const;
  const ALLOWED_PAYMENT_STATUSES = [
    "pending",
    "paid",
    "failed",
    "refunded",
  ] as const;

  const filter: Record<string, unknown> = {};
  const statusParam = req.query.status as string | undefined;
  const paymentStatusParam = req.query.paymentStatus as string | undefined;
  const searchQ = String(req.query.search || "")
    .trim()
    .slice(0, 80);

  if (
    statusParam &&
    (ALLOWED_STATUSES as readonly string[]).includes(statusParam)
  ) {
    filter.status = statusParam;
  }
  if (
    paymentStatusParam &&
    (ALLOWED_PAYMENT_STATUSES as readonly string[]).includes(paymentStatusParam)
  ) {
    filter.paymentStatus = paymentStatusParam;
  }

  if (searchQ) {
    const escaped = searchQ.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const regex = { $regex: escaped, $options: "i" };
    const matchingUsers = await User.find({
      $or: [{ name: regex }, { email: regex }, { phone: regex }],
    })
      .select("_id")
      .limit(50)
      .lean();
    const userIds = matchingUsers.map((u) => u._id);
    filter.$or = [
      { orderNumber: regex },
      ...(userIds.length ? [{ user: { $in: userIds } }] : []),
    ];
  }

  if (req.query.missingManualCost === "true") {
    filter.paymentStatus = "paid";
    filter.offlineMeta = { $exists: true };
    filter.items = {
      $elemMatch: {
        $and: [
          {
            $or: [
              { isOfflineManual: true },
              { slug: "offline-manual-item" },
              { "variant.sku": "SYS-OFFLINE-MANUAL" },
            ],
          },
          {
            $or: [
              { costAtSale: { $exists: false } },
              { costAtSale: null },
              { costAtSale: { $lte: 0 } },
            ],
          },
        ],
      },
    };
  }

  const VALID_CHANNELS: OrderSalesChannelFilter[] = [
    "all",
    "online",
    "offline",
    "b2b",
  ];
  const rawChannel = String(req.query.channel ?? "all");
  const channel: OrderSalesChannelFilter =
    VALID_CHANNELS.includes(rawChannel as OrderSalesChannelFilter) ?
      (rawChannel as OrderSalesChannelFilter)
    : "all";
  if (channel !== "all") {
    Object.assign(filter, orderChannelMatch(channel));
  }

  const [orders, total] = await Promise.all([
    Order.find(filter)
      .sort(mongoSort)
      .skip(skip)
      .limit(limit)
      .select(
        "orderNumber status paymentStatus total createdAt user items shippingAddress offlineMeta b2bMeta taxSalesInvoiceId",
      )
      .populate("user", "name email phone"),
    Order.countDocuments(filter),
  ]);

  sendPaginated(res, { orders }, { page, limit, total });
});

export const getOrderDetails = catchAsync(
  async (req: Request, res: Response, next: NextFunction) => {
    if (!Types.ObjectId.isValid(req.params.id)) {
      return next(new AppError("Invalid order id.", 400));
    }
    const order = await Order.findById(req.params.id)
      .populate("user", "name email phone")
      .populate("items.product", "name images hsnCode")
      .populate("taxSalesInvoiceId", "invoiceNumber");

    if (!order) return next(new AppError("Order not found.", 404));
    sendSuccess(res, { order });
  },
);

export const updateOrderLineCostAtSale = catchAsync(
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!Types.ObjectId.isValid(req.params.id)) {
      return next(new AppError("Invalid order id.", 400));
    }

    const lineIndex = Number(req.params.lineIndex);
    if (!Number.isInteger(lineIndex) || lineIndex < 0) {
      return next(new AppError("Invalid line index.", 400));
    }

    const costAtSale = Number(req.body?.costAtSale);
    if (!Number.isFinite(costAtSale) || costAtSale < 0) {
      return next(new AppError("Enter a valid cost of goods (0 or more).", 400));
    }

    const order = await Order.findById(req.params.id);
    if (!order) return next(new AppError("Order not found.", 404));
    if (lineIndex >= order.items.length) {
      return next(new AppError("Order line not found.", 404));
    }

    const item = order.items[lineIndex]!;
    if (!isManualOfflineOrderItem(item)) {
      return next(
        new AppError(
          "Cost of goods can only be updated on manual category/offline lines.",
          400,
        ),
      );
    }

    const previous = item.costAtSale ?? 0;
    item.costAtSale = Math.round(Math.max(0, costAtSale) * 100) / 100;
    order.markModified("items");
    await order.save();

    await writeAdminAudit(req, "order.line_cost_at_sale", {
      orderId: String(order._id),
      orderNumber: order.orderNumber,
      lineIndex,
      lineName: item.name,
      previous,
      next: item.costAtSale,
    });

    sendSuccess(res, {
      orderId: order._id,
      lineIndex,
      costAtSale: item.costAtSale,
      lineName: item.name,
    });
  },
);

// ─── Delete ───────────────────────────────────────────────────────────────────

export const deleteOrder = catchAsync(
  async (req: Request, res: Response, next: NextFunction) => {
    if (!Types.ObjectId.isValid(req.params.id)) {
      return next(new AppError("Invalid order id.", 400));
    }
    const order = await Order.findById(req.params.id);
    if (!order) return next(new AppError("Order not found.", 404));

    await order.deleteOne();

    res.status(204).end();
  }
);

// ─── Status Update ────────────────────────────────────────────────────────────

export const updateOrderStatus = catchAsync(
  async (req: Request, res: Response, next: NextFunction) => {
    const { status, note, shippingCarrier, trackingNumber, trackingUrl } =
      req.body;

    if (!Types.ObjectId.isValid(req.params.id)) {
      return next(new AppError("Invalid order id.", 400));
    }

    const order = await Order.findById(req.params.id);
    if (!order) return next(new AppError("Order not found.", 404));

    const previousStatus = order.status;
    const sameStatus = order.status === status;
    const previous = String(previousStatus) as ManagedOrderStatus;
    const requested = String(status) as ManagedOrderStatus;

    const carrierTrimmed =
      typeof shippingCarrier === "string" ? shippingCarrier.trim() : undefined;
    const trackingTrimmed =
      typeof trackingNumber === "string" ? trackingNumber.trim() : undefined;
    const urlTrimmed =
      typeof trackingUrl === "string" ? trackingUrl.trim() : undefined;
    const noteTrimmed = typeof note === "string" ? note.trim() : undefined;

    const hasTrackingUpdate =
      carrierTrimmed !== undefined ||
      trackingTrimmed !== undefined ||
      urlTrimmed !== undefined;

    if (sameStatus && !noteTrimmed && !hasTrackingUpdate) {
      return next(new AppError("No changes to update.", 400));
    }

    if (!sameStatus) {
      const allowed = ALLOWED_STATUS_TRANSITIONS[previous];
      if (!allowed || !allowed.includes(requested)) {
        return next(
          new AppError(
            `Invalid status change from ${previousStatus} to ${status}.`,
            400,
          ),
        );
      }
    }

    // Delegate cancellation to the service (handles stock restore + transaction)
    if (status === "cancelled" && previousStatus !== "cancelled") {
      const { order: cancelledOrder } = await cancelOrder(
        String(order._id),
        (req as AuthRequest).user?._id,
        noteTrimmed,
      );

      // Notify after successful commit
      const populated = await Order.findById(cancelledOrder._id).populate(
        "user",
        "name email",
      );
      const user = populated?.user as unknown as
        | { _id?: unknown; name?: string; email?: string }
        | undefined;

      if (populated && user?._id) {
        if (user.email && isCustomerDeliverableEmail(user.email)) {
          const tpl = emailTemplates.orderStatusUpdate(
            user.name || "Customer",
            populated.orderNumber,
            "cancelled",
          );
          enqueueEmail({
            to: user.email,
            subject: tpl.subject,
            html: tpl.html,
          }).catch((e: Error) =>
            logger.warn(`Cancel email enqueue failed: ${e.message}`),
          );
        }

        const { notifyWhatsAppOrderStatusChange } = await import(
          "../../services/whatsappNotifyService"
        );
        void notifyWhatsAppOrderStatusChange({
          userId: String(user._id),
          orderId: String(populated._id),
          orderNumber: populated.orderNumber!,
          status: "cancelled",
        }).catch(() => {});

        const cancelCopy = getOrderCancelledByAdminCopy(populated.orderNumber!);
        notifyUser(
          String(user._id),
          cancelCopy.title,
          cancelCopy.message,
          `/dashboard/orders/${populated._id}`,
          cancelCopy.type,
        ).catch((e: Error) =>
          logger.warn(`Cancel notify failed: ${e.message}`),
        );

        if (user.email) {
          const adminTpl = emailTemplates.adminOrderCancelled(
            user.name || "Customer",
            user.email,
            populated.orderNumber!,
            String(cancelledOrder._id),
            noteTrimmed,
            "admin",
          );
          notifyAdminsEmail(adminTpl.subject, adminTpl.html).catch((e: Error) =>
            logger.warn(`Admin cancel email failed: ${e.message}`),
          );
        }
      }

      return sendSuccess(res, { order: cancelledOrder });
    }

    // All other status updates handled directly (no stock changes)
    order.status = status;

    if (!sameStatus) {
      order.statusHistory.push({
        status,
        timestamp: new Date(),
        note: noteTrimmed,
      });
    } else if (noteTrimmed) {
      const last = order.statusHistory[order.statusHistory.length - 1];
      if (last && last.status === status) {
        last.note = noteTrimmed;
        last.timestamp = new Date();
      }
    }

    if (status === "shipped") {
      if (!order.shippedAt) order.shippedAt = new Date();
      if (carrierTrimmed) order.shippingCarrier = carrierTrimmed;
      if (trackingTrimmed) order.trackingNumber = trackingTrimmed;
      if (urlTrimmed) order.trackingUrl = urlTrimmed;
    }

    if (status === "delivered") {
      order.deliveredAt = new Date();
      order.paymentStatus = "paid";
      if (!order.invoice?.isGenerated) {
        order.invoice = { isGenerated: true, generatedAt: new Date() };
      }
    }

    await order.save();

    if (status === "delivered" && previousStatus !== "delivered") {
      void onOrderDelivered(String(order._id), String(order.user)).catch(
        () => {},
      );
    }

    const populated = await Order.findById(order._id).populate(
      "user",
      "name email",
    );
    const user = populated?.user as unknown as
      | { _id?: unknown; name?: string; email?: string }
      | undefined;

    if (!sameStatus && populated && user?._id && status !== "delivered") {
      const trackingOpts =
        status === "shipped" ?
          {
            carrier: order.shippingCarrier,
            awb: order.trackingNumber,
            trackingUrl: order.trackingUrl,
          }
        : undefined;

      if (user.email && isCustomerDeliverableEmail(user.email)) {
        const tpl = emailTemplates.orderStatusUpdate(
          user.name || "Customer",
          populated.orderNumber,
          populated.status,
          trackingOpts,
        );
        enqueueEmail({
          to: user.email,
          subject: tpl.subject,
          html: tpl.html,
        }).catch(() => {});
      }

      if (status !== "delivered") {
        const { notifyWhatsAppOrderStatusChange } = await import(
          "../../services/whatsappNotifyService"
        );
        void notifyWhatsAppOrderStatusChange({
          userId: String(user._id),
          orderId: String(populated._id),
          orderNumber: populated.orderNumber!,
          status,
          carrier: order.shippingCarrier,
          awb: order.trackingNumber,
        }).catch(() => {});
      }

      const statusCopy = getOrderStatusUpdateCopy(
        populated.orderNumber!,
        status,
        trackingOpts,
      );
      notifyUser(
        String(user._id),
        statusCopy.title,
        statusCopy.message,
        `/dashboard/orders/${populated._id}`,
        statusCopy.type,
      ).catch(() => {});
    }

    sendSuccess(res, { order });
  },
);

// ─── Invoice ─────────────────────────────────────────────────────────────────

export const generateOrderInvoice = catchAsync(
  async (req: Request, res: Response, next: NextFunction) => {
    if (!Types.ObjectId.isValid(req.params.id)) {
      return next(new AppError("Invalid order id.", 400));
    }
    const order = await Order.findById(req.params.id);
    if (!order) return next(new AppError("Order not found.", 404));

    const invoiceEligible =
      order.paymentStatus === "paid" || order.status === "delivered";
    if (!invoiceEligible) {
      return next(
        new AppError(
          "Invoice can be generated only for paid or delivered orders.",
          400,
        ),
      );
    }

    if (!order.invoice?.isGenerated) {
      order.invoice = { isGenerated: true, generatedAt: new Date() };
      await order.save();
    }

    sendSuccess(
      res,
      { invoice: order.invoice, orderId: String(order._id) },
      "Invoice generated.",
    );
  },
);

// ─── Refund ───────────────────────────────────────────────────────────────────

export const processRefundController = catchAsync(
  async (req: Request, res: Response, next: NextFunction) => {
    const { refundMethod, amount, notes } = req.body;
    const amt = typeof amount === "number" ? amount : Number(amount);

    const { order, gatewayRefundId } = await processRefund(req, req.params.id, {
      refundMethod,
      amount: amt,
      notes,
    });

    const populated = await Order.findById(order._id).populate(
      "user",
      "name email",
    );
    const user = populated?.user as unknown as
      | { _id?: unknown; name?: string; email?: string }
      | undefined;
    const bankDetails = (
      order as unknown as {
        returnRequest?: {
          userBankDetails?: {
            upiId?: string;
            accountName?: string;
            accountNumber?: string;
            bankName?: string;
          };
        };
      }
    ).returnRequest?.userBankDetails;

    if (populated && user?.email && isCustomerDeliverableEmail(user.email)) {
      const methodToUse = order.refundData?.method ?? refundMethod ?? "cash";
      const smartMessage =
        methodToUse === "razorpay_auto" ?
          `₹${amt.toFixed(2)} refund initiated to your original payment method. (5-7 business days)`
        : methodToUse === "upi_manual" ?
          `₹${amt.toFixed(2)} will be sent to your UPI ID: ${bankDetails?.upiId ?? "your UPI"}. (1-2 days)`
        : methodToUse === "bank_transfer" ?
          `₹${amt.toFixed(2)} will be transferred to your bank account ending ${(bankDetails?.accountNumber ?? "").slice(-4) || "—"}. (2-3 days)`
        : `₹${amt.toFixed(2)} refund has been initiated via ${methodToUse.replace(/_/g, " ")}.`;

      // Fire-and-forget notifications
      if (user._id) {
        const refundCopy = getRefundProcessedCopy(
          populated.orderNumber!,
          amt,
          smartMessage,
        );
        notifyUser(
          String(user._id),
          refundCopy.title,
          refundCopy.message,
          `/dashboard/orders/${populated._id}`,
          refundCopy.type,
        ).catch(() => {});
      }

      const tpl = emailTemplates.userRefundProcessed(
        user.name || "Customer",
        populated.orderNumber!,
        amt,
        methodToUse,
        {
          upiId: bankDetails?.upiId,
          accountName: bankDetails?.accountName,
          accountNumber: bankDetails?.accountNumber,
          bankName: bankDetails?.bankName,
        },
      );
      enqueueEmail({
        to: user.email,
        subject: tpl.subject,
        html: tpl.html,
      }).catch(() => {});

      const adminTpl = emailTemplates.adminRefundProcessed(
        user.name || "Customer",
        user.email,
        populated.orderNumber!,
        String(order._id),
        amt,
        methodToUse,
      );
      notifyAdminsEmail(adminTpl.subject, adminTpl.html).catch(() => {});

      notifyAdmins(
        `Refund processed — ${populated.orderNumber}`,
        `₹${amt.toFixed(2)} refunded to ${user.name ?? "customer"} via ${methodToUse.replace(/_/g, " ")}.`,
        `/admin/orders/${populated._id}`,
        "order",
      ).catch(() => {});
    }

    sendSuccess(res, { order }, "Order refunded successfully.");
  },
);
