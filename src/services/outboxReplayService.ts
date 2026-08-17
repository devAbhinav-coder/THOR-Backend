import OrderEventOutbox from "../models/OrderEventOutbox";
import CartEventOutbox from "../models/CartEventOutbox";
import InventoryEventOutbox from "../models/InventoryEventOutbox";
import CouponBroadcastOutbox from "../models/CouponBroadcastOutbox";
import GiftingEventOutbox from "../models/GiftingEventOutbox";
import PushNotificationOutbox from "../models/PushNotificationOutbox";
import BlogPublishOutbox from "../models/BlogPublishOutbox";
import AppError from "../types/utils/AppError";
import { Model } from "mongoose";
import { dispatchOutboxById as dispatchOrderOutbox } from "./orderEventOutboxService";
import { dispatchCartOutboxById } from "./cart/cartOutboxService";
import { dispatchInventoryOutboxById } from "./inventory/inventoryOutboxService";
import { dispatchCouponBroadcastById } from "./coupon/couponBroadcastOutboxService";
import { dispatchGiftingOutboxById } from "./gifting/giftingNotificationService";
import { dispatchPushOutboxById } from "./notifications/pushOutboxService";
import { dispatchBlogPublishOutboxById } from "./blogPublishOutboxService";

export type OutboxType =
  | "order"
  | "cart"
  | "inventory"
  | "coupon"
  | "gifting"
  | "push"
  | "blog_publish";

const MODELS: Record<OutboxType, Model<unknown>> = {
  order: OrderEventOutbox as Model<unknown>,
  cart: CartEventOutbox as Model<unknown>,
  inventory: InventoryEventOutbox as Model<unknown>,
  coupon: CouponBroadcastOutbox as Model<unknown>,
  gifting: GiftingEventOutbox as Model<unknown>,
  push: PushNotificationOutbox as Model<unknown>,
  blog_publish: BlogPublishOutbox as Model<unknown>,
};

export async function listDeadLetterOutbox(
  type: OutboxType,
  limit = 50,
): Promise<unknown[]> {
  const Model = MODELS[type];
  return Model.find({ status: "dead_letter" })
    .sort({ updatedAt: -1 })
    .limit(limit)
    .lean();
}

export async function replayOutboxEntry(
  type: OutboxType,
  outboxId: string,
): Promise<boolean> {
  const Model = MODELS[type];
  const row = await Model.findOneAndUpdate(
    { _id: outboxId, status: "dead_letter" },
    {
      $set: {
        status: "pending",
        attempts: 0,
        nextAttemptAt: new Date(),
        lastError: undefined,
      },
    },
    { new: true },
  );
  if (!row) {
    throw new AppError("Outbox entry not found or not in dead_letter state.", 404);
  }

  switch (type) {
    case "order":
      return dispatchOrderOutbox(outboxId);
    case "cart":
      return dispatchCartOutboxById(outboxId);
    case "inventory":
      return dispatchInventoryOutboxById(outboxId);
    case "coupon":
      return dispatchCouponBroadcastById(outboxId);
    case "gifting":
      return dispatchGiftingOutboxById(outboxId);
    case "push":
      return dispatchPushOutboxById(outboxId);
    case "blog_publish":
      return dispatchBlogPublishOutboxById(outboxId);
    default:
      throw new AppError("Unknown outbox type.", 400);
  }
}
