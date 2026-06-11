import mongoose, { ClientSession } from "mongoose";
import Order from "../../models/Order";
import GiftingRequest from "../../models/GiftingRequest";
import AppError from "../../types/utils/AppError";
import { AuthRequest, IOrderItem } from "../../types";
import { buildCustomOrderItems } from "../giftingService";
import { runInTransaction } from "../../types/utils/mongoTransaction";
import { recordGiftingMetric } from "./giftingMetricsService";
import logger from "../../types/utils/logger";
import { getRequestContext } from "../../types/utils/requestContext";

export interface GiftingShippingAddress {
  name: string;
  phone?: string;
  label?: string;
  street: string;
  city: string;
  state: string;
  pincode: string;
  country?: string;
}

type PopulatedGiftingRequest = {
  _id: mongoose.Types.ObjectId;
  status: string;
  linkedOrderId?: mongoose.Types.ObjectId;
  quotedPrice?: number;
  occasion: string;
  name: string;
  items: Parameters<typeof buildCustomOrderItems>[0]["items"];
  user?: mongoose.Types.ObjectId;
};

export async function createOrderFromGiftingQuote(
  req: AuthRequest,
  requestId: string,
  shippingAddress: GiftingShippingAddress,
  idempotencyKey?: string | null,
): Promise<{
  orderId: string;
  orderNumber: string;
  idempotentReplay: boolean;
}> {
  const ctx = getRequestContext();
  const userId = String(req.user?._id);

  if (idempotencyKey) {
    const byKey = await GiftingRequest.findOne({
      acceptIdempotencyKey: idempotencyKey,
      user: req.user?._id,
    }).lean();
    if (byKey?.linkedOrderId) {
      const existing = await Order.findById(byKey.linkedOrderId)
        .select("orderNumber")
        .lean();
      if (existing) {
        recordGiftingMetric("gifting.order.duplicate_prevented", {
          phase: "idempotency_key",
        });
        return {
          orderId: String(byKey.linkedOrderId),
          orderNumber: existing.orderNumber,
          idempotentReplay: true,
        };
      }
    }
  }

  const existingLinked = await GiftingRequest.findOne({
    _id: requestId,
    user: req.user?._id,
    linkedOrderId: { $exists: true, $ne: null },
  })
    .select("linkedOrderId")
    .lean();

  if (existingLinked?.linkedOrderId) {
    const order = await Order.findById(existingLinked.linkedOrderId)
      .select("orderNumber")
      .lean();
    if (order) {
      recordGiftingMetric("gifting.order.duplicate_prevented", {
        phase: "linked_order",
      });
      return {
        orderId: String(existingLinked.linkedOrderId),
        orderNumber: order.orderNumber,
        idempotentReplay: true,
      };
    }
  }

  const result = await runInTransaction(async (session: ClientSession) => {
    const request = await GiftingRequest.findOne({
      _id: requestId,
      user: req.user?._id,
      status: "price_quoted",
      $or: [{ linkedOrderId: { $exists: false } }, { linkedOrderId: null }],
    }).session(session);

    if (!request) {
      throw new AppError("Only quoted requests can be accepted.", 400);
    }

    await request.populate("items.product", "name description images price");

    if (!request.quotedPrice || request.quotedPrice <= 0) {
      throw new AppError("Quote price is missing on this request.", 400);
    }

    const orderItems: IOrderItem[] = buildCustomOrderItems(
      request as unknown as PopulatedGiftingRequest,
    );

    const subtotal = request.quotedPrice;
    const created = await Order.create(
      [
        {
          user: req.user?._id,
          items: orderItems,
          shippingAddress: {
            name: shippingAddress.name,
            phone: shippingAddress.phone || req.user?.phone || "",
            label: shippingAddress.label || "Home",
            street: shippingAddress.street,
            city: shippingAddress.city,
            state: shippingAddress.state,
            pincode: shippingAddress.pincode,
            country: shippingAddress.country || "India",
          },
          status: "pending",
          paymentStatus: "pending",
          paymentMethod: "cod",
          subtotal,
          discount: 0,
          shippingCharge: 0,
          tax: 0,
          total: subtotal,
          productType: "custom",
          customRequestId: request._id,
        },
      ],
      { session },
    );

    const order = created[0]!;

    const updated = await GiftingRequest.findOneAndUpdate(
      {
        _id: requestId,
        status: "price_quoted",
        $or: [{ linkedOrderId: { $exists: false } }, { linkedOrderId: null }],
      },
      {
        $set: {
          status: "approved_by_user",
          linkedOrderId: order._id,
          ...(idempotencyKey ? { acceptIdempotencyKey: idempotencyKey } : {}),
        },
      },
      { session, new: true },
    );

    if (!updated) {
      throw new AppError(
        "Quote was already accepted or is no longer available.",
        409,
      );
    }

    return { order, request };
  }, "gifting.accept_quote");

  logger.info({
    msg: "gifting_order_created",
    requestId,
    orderId: String(result.order._id),
    userId,
    requestId_ctx: ctx?.requestId,
  });

  recordGiftingMetric("gifting.order.created", { giftingRequestId: requestId });
  recordGiftingMetric("gifting.quote.accepted", {
    giftingRequestId: requestId,
  });

  return {
    orderId: String(result.order._id),
    orderNumber: result.order.orderNumber,
    idempotentReplay: false,
  };
}
