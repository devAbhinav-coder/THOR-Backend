import { Request, Response, NextFunction } from "express";
import { Types } from "mongoose";
import Order from "../../models/Order";
import AppError from "../../types/utils/AppError";
import catchAsync from "../../types/utils/catchAsync";
import { emailTemplates } from "../../services/emailService";
import { enqueueEmail } from "../../queues/emailQueue";
import {
  notifyUser,
  notifyAdmins,
  notifyAdminsEmail,
} from "../../services/notificationService";
import { getReturnResolvedCopy } from "../../services/notifications/orderNotificationCopy";
import { sendPaginated, sendSuccess } from "../../types/utils/response";
import { resolveReturn } from "../../services/adminReturnService";
import { getCache, setCache, deleteCache } from "../../services/cacheService";
import logger from "../../types/utils/logger";

const RETURNS_INSIGHTS_CACHE_KEY = "analytics:returns:insights";
const RETURNS_INSIGHTS_TTL = 180; // 3 minutes

const RETURN_STATUS_FILTER = [
  "requested",
  "approved",
  "rejected",
  "returned",
] as const;

export const getReturns = catchAsync(
  async (req: Request, res: Response, next: NextFunction) => {
    const page = Math.max(1, parseInt((req.query.page as string) || "1", 10));
    const limit = Math.min(
      50,
      Math.max(1, parseInt((req.query.limit as string) || "20", 10)),
    );
    const status = req.query.status as string | undefined;

    if (
      status &&
      !(RETURN_STATUS_FILTER as readonly string[]).includes(status)
    ) {
      return next(
        new AppError(
          `Invalid return status. Allowed: ${RETURN_STATUS_FILTER.join(", ")}.`,
          400,
        ),
      );
    }

    const filter: Record<string, unknown> = {
      returnStatus: { $in: status ? [status] : [...RETURN_STATUS_FILTER] },
    };

    const [total, orders] = await Promise.all([
      Order.countDocuments(filter),
      Order.find(filter)
        .sort({ "returnRequest.requestedAt": -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .populate("user", "name email phone")
        .select(
          "orderNumber total status returnStatus returnRequest refundData paymentMethod createdAt deliveredAt items",
        ),
    ]);

    sendPaginated(res, { orders }, { total, page, limit });
  },
);

export const getReturnsInsights = catchAsync(
  async (_req: Request, res: Response) => {
    // Cache the 5 parallel aggregations — they're expensive and don't need real-time accuracy
    const cached = await getCache<Record<string, unknown>>(
      RETURNS_INSIGHTS_CACHE_KEY,
    );
    if (cached) {
      return sendSuccess(res, cached);
    }

    const returnMatch = { returnStatus: { $in: [...RETURN_STATUS_FILTER] } };

    const [
      statusBreakdown,
      refundedAgg,
      reasons,
      topProducts,
      topCustomersRaw,
    ] = await Promise.all([
      Order.aggregate<{ _id: string; count: number }>([
        { $match: returnMatch },
        { $group: { _id: "$returnStatus", count: { $sum: 1 } } },
      ]),
      Order.aggregate<{ total: number; count: number }>([
        {
          $match: {
            paymentStatus: "refunded",
            "refundData.amount": { $exists: true },
          },
        },
        {
          $group: {
            _id: null,
            total: { $sum: "$refundData.amount" },
            count: { $sum: 1 },
          },
        },
      ]),
      Order.aggregate<{ _id: string; count: number }>([
        { $match: returnMatch },
        {
          $match: {
            "returnRequest.reason": { $exists: true, $nin: ["", null] },
          },
        },
        { $group: { _id: "$returnRequest.reason", count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 25 },
      ]),
      Order.aggregate<{
        _id: Types.ObjectId;
        name: string;
        sku?: string;
        returnCount: number;
      }>([
        { $match: returnMatch },
        { $unwind: "$items" },
        {
          $group: {
            _id: "$items.product",
            name: { $first: "$items.name" },
            sku: { $first: "$items.variant.sku" },
            returnCount: { $sum: 1 },
          },
        },
        { $sort: { returnCount: -1 } },
        { $limit: 20 },
      ]),
      Order.aggregate([
        { $match: returnMatch },
        { $group: { _id: "$user", returnCount: { $sum: 1 } } },
        { $sort: { returnCount: -1 } },
        { $limit: 20 },
        {
          $lookup: {
            from: "users",
            localField: "_id",
            foreignField: "_id",
            as: "userDoc",
          },
        },
        { $unwind: { path: "$userDoc", preserveNullAndEmptyArrays: true } },
        {
          $project: {
            _id: 0,
            userId: "$_id",
            returnCount: 1,
            name: "$userDoc.name",
            email: "$userDoc.email",
          },
        },
      ]),
    ]);

    const statusMap = Object.fromEntries(
      statusBreakdown.map((s) => [s._id, s.count]),
    ) as Record<string, number>;
    const totalReturnOrders = statusBreakdown.reduce(
      (acc, s) => acc + s.count,
      0,
    );
    const ref = refundedAgg[0];

    const payload = {
      summary: {
        totalReturnOrders,
        requested: statusMap.requested ?? 0,
        approved: statusMap.approved ?? 0,
        rejected: statusMap.rejected ?? 0,
        returned: statusMap.returned ?? 0,
        totalRefundedAmount: ref?.total ?? 0,
        refundedOrdersCount: ref?.count ?? 0,
      },
      reasons,
      topProducts: topProducts.map((p) => ({
        productId: String(p._id),
        name: p.name || "Product",
        sku: p.sku || "",
        returnCount: p.returnCount,
      })),
      topCustomers: (
        topCustomersRaw as {
          userId?: unknown;
          name?: string;
          email?: string;
          returnCount: number;
        }[]
      ).map((c) => ({
        userId: String(c.userId ?? ""),
        name: c.name || "—",
        email: c.email || "",
        returnCount: c.returnCount,
      })),
    };

    setCache(RETURNS_INSIGHTS_CACHE_KEY, payload, RETURNS_INSIGHTS_TTL).catch(
      (e: Error) =>
        logger.warn(`Returns insights cache set failed: ${e.message}`),
    );

    sendSuccess(res, payload);
  },
);

export const resolveReturnController = catchAsync(
  async (req: Request, res: Response, next: NextFunction) => {
    const { id } = req.params;
    const { action, adminNote } = req.body as {
      action: "approve" | "reject";
      adminNote?: string;
    };

    if (!["approve", "reject"].includes(action)) {
      return next(new AppError("Action must be approve or reject", 400));
    }

    const { order, newStatus } = await resolveReturn(
      req,
      id,
      action,
      adminNote,
    );

    // Invalidate returns insights cache so next load reflects the change
    deleteCache(RETURNS_INSIGHTS_CACHE_KEY).catch(() => {});

    // Fire-and-forget notifications after successful DB commit
    const user = order.user as unknown as {
      _id?: string;
      name?: string;
      email?: string;
    };

    if (user?.email) {
      const tpl = emailTemplates.userReturnStatusUpdated(
        user.name || "Customer",
        order.orderNumber!,
        newStatus as "approved" | "rejected",
        adminNote,
      );
      enqueueEmail({
        to: user.email,
        subject: tpl.subject,
        html: tpl.html,
      }).catch(() => {});

      const returnCopy = getReturnResolvedCopy(
        order.orderNumber!,
        action === "approve",
        adminNote,
      );
      notifyUser(
        String(user._id),
        returnCopy.title,
        returnCopy.message,
        `/dashboard/orders/${order._id}`,
        returnCopy.type,
      ).catch(() => {});
    }

    notifyAdmins(
      `Return ${newStatus} — ${order.orderNumber}`,
      `You have ${newStatus} the return request from ${user?.name || "a customer"}.`,
      `/admin/orders/${order._id}`,
      "order",
    ).catch(() => {});

    const adminTpl = emailTemplates.adminReturnResolved(
      user?.name || "Customer",
      order.orderNumber!,
      String(order._id),
      newStatus as "approved" | "rejected",
      adminNote,
    );
    notifyAdminsEmail(adminTpl.subject, adminTpl.html).catch(() => {});

    sendSuccess(res, { order }, `Return ${newStatus} successfully.`);
  },
);
