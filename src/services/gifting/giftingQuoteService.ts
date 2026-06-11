import User from "../../models/User";
import { AuthRequest } from "../../types";
import AppError from "../../types/utils/AppError";
import { giftingRepository } from "../../repositories/giftingRepository";
import { normalizeIdempotencyKey } from "../checkoutConcurrency";
import {
  assertAdminStatusTransition,
  assertCanAcceptQuote,
  assertCanRejectQuote,
  assertQuoteFieldsForStatus,
  GiftingStatus,
} from "./giftingWorkflow";
import {
  createOrderFromGiftingQuote,
  GiftingShippingAddress,
} from "./giftingOrderService";
import { notifyAdmins, notifyUser } from "../notificationService";
import { enqueueGiftingSideEffect } from "./giftingNotificationService";
import { serializeGiftingRequest } from "../../types/utils/giftingDto";
import { recordGiftingMetric } from "./giftingMetricsService";
import logger from "../../types/utils/logger";
import { getRequestContext } from "../../types/utils/requestContext";

const extractObjectIdString = (value: unknown): string | null => {
  if (!value) return null;
  if (typeof value === "string") return value;
  if (typeof value === "object" && value !== null && "_id" in value) {
    return String((value as { _id: unknown })._id);
  }
  return String(value);
};

export async function updateGiftingRequestAdmin(
  id: string,
  body: {
    status?: GiftingStatus;
    adminNote?: string;
    quotedPrice?: number;
    deliveryTime?: string;
  },
) {
  const request = await giftingRepository.findById(id);
  if (!request) throw new AppError("Gifting request not found", 404);

  const currentStatus = request.status as GiftingStatus;
  if (body.status) {
    assertAdminStatusTransition(currentStatus, body.status);
    assertQuoteFieldsForStatus(
      body.status,
      body.quotedPrice ?? request.quotedPrice,
    );
  }

  if (body.status) request.status = body.status;
  if (body.adminNote !== undefined) request.adminNote = body.adminNote?.trim();
  if (body.quotedPrice !== undefined)
    request.quotedPrice = Number(body.quotedPrice);
  if (body.deliveryTime !== undefined)
    request.deliveryTime = body.deliveryTime?.trim();

  await request.save();

  if (body.status === "price_quoted" && request.user) {
    recordGiftingMetric("gifting.quote.sent", { giftingRequestId: id });
    const userDoc = await User.findById(request.user)
      .select("name email")
      .lean();
    if (userDoc) {
      notifyUser(
        request.user,
        "Quote Ready for Your Custom Gift 🎁",
        `Your custom gift request for "${request.occasion}" has been quoted at ₹${request.quotedPrice?.toLocaleString("en-IN")}. Review and accept to place your order.`,
        `/dashboard/gifting/${request._id}`,
        "order",
      ).catch(() => {});

      void enqueueGiftingSideEffect(
        "email_user_quote",
        {
          userName: userDoc.name,
          email: userDoc.email,
          occasion: request.occasion,
          quotedPrice: request.quotedPrice,
          deliveryTime: request.deliveryTime || "To be confirmed",
          adminNote: request.adminNote,
          requestId: String(request._id),
        },
        `gifting:email:user:quote:${request._id}`,
      );
    }
  }

  const populated = await giftingRepository.findByIdWithDetails(
    String(request._id),
  );
  return serializeGiftingRequest(populated?.toObject?.() ?? populated);
}

export async function respondToQuote(
  req: AuthRequest,
  id: string,
  action: "accept" | "reject",
  shippingAddress?: GiftingShippingAddress,
) {
  const request = await giftingRepository.findById(id);
  if (!request) throw new AppError("Gifting request not found", 404);

  const requestUserId = extractObjectIdString(request.user);
  if (requestUserId !== req.user?._id.toString()) {
    throw new AppError(
      "You are not authorized to respond to this request.",
      403,
    );
  }

  const ctx = getRequestContext();

  if (action === "reject") {
    assertCanRejectQuote(request.status as GiftingStatus);
    request.status = "rejected_by_user";
    await request.save();

    recordGiftingMetric("gifting.quote.rejected", { giftingRequestId: id });

    notifyAdmins(
      "Custom Gift Quote Rejected",
      `${req.user?.name || request.name} rejected the quote for "${request.occasion}".`,
      "/admin/gifting",
      "alert",
    ).catch(() => {});

    void enqueueGiftingSideEffect(
      "email_admin_quote_rejected",
      {
        userName: req.user?.name || request.name,
        occasion: request.occasion,
        requestId: String(request._id),
      },
      `gifting:email:admin:reject:${id}`,
    );

    return { message: "Request rejected and closed." };
  }

  if (action === "accept") {
    assertCanAcceptQuote(request.status as GiftingStatus);

    if (
      !shippingAddress ||
      !shippingAddress.name ||
      !shippingAddress.street ||
      !shippingAddress.city ||
      !shippingAddress.state ||
      !shippingAddress.pincode
    ) {
      throw new AppError(
        "A valid shipping address is required to accept the quote.",
        400,
      );
    }

    const idempotencyKey = normalizeIdempotencyKey(
      req.headers["idempotency-key"] as string | undefined,
    );

    const { orderId, orderNumber, idempotentReplay } =
      await createOrderFromGiftingQuote(
        req,
        id,
        shippingAddress,
        idempotencyKey,
      );

    if (!idempotentReplay) {
      notifyUser(
        req.user?._id,
        "Custom Gift Order Created 🎁",
        `Your custom gift order ${orderNumber} has been created. Our team will reach out to arrange payment and delivery.`,
        `/dashboard/orders/${orderId}`,
        "order",
      ).catch(() => {});

      void enqueueGiftingSideEffect(
        "email_user_order_created",
        {
          userName: req.user?.name || request.name,
          email: req.user?.email,
          occasion: request.occasion,
          orderNumber,
          quotedPrice: request.quotedPrice,
          orderId,
        },
        `gifting:email:user:order:${orderId}`,
      );

      notifyAdmins(
        "Custom Gift Quote Accepted ✅",
        `${req.user?.name || request.name} accepted the quote for "${request.occasion}". Order ${orderNumber} created.`,
        `/admin/orders/${orderId}`,
        "order",
      ).catch(() => {});

      void enqueueGiftingSideEffect(
        "email_admin_quote_accepted",
        {
          userName: req.user?.name || request.name,
          occasion: request.occasion,
          orderNumber,
          quotedPrice: request.quotedPrice,
          orderId,
        },
        `gifting:email:admin:accept:${orderId}`,
      );
    }

    logger.info({
      msg: "gifting_quote_accepted",
      giftingRequestId: id,
      orderId,
      requestId: ctx?.requestId,
      idempotentReplay,
    });

    return { orderId, orderNumber };
  }

  throw new AppError('Invalid action. Use "accept" or "reject".', 400);
}
