import Cart from "../../models/Cart";
import CartRecoveryLog from "../../models/CartRecoveryLog";
import Order from "../../models/Order";
import CheckoutPaymentIntent from "../../models/CheckoutPaymentIntent";
import Coupon from "../../models/Coupon";
import SaleCampaign from "../../models/SaleCampaign";
import ReviewInvite from "../../models/ReviewInvite";
import OrderEventOutbox from "../../models/OrderEventOutbox";
import CartEventOutbox from "../../models/CartEventOutbox";
import InventoryEventOutbox from "../../models/InventoryEventOutbox";
import CouponBroadcastOutbox from "../../models/CouponBroadcastOutbox";
import GiftingEventOutbox from "../../models/GiftingEventOutbox";
import PushNotificationOutbox from "../../models/PushNotificationOutbox";
import BlogPublishOutbox from "../../models/BlogPublishOutbox";
import logger from "../../types/utils/logger";
import { emailTemplates } from "../emailService";
import { enqueueEmail } from "../../queues/emailQueue";
import { queuePushForUser } from "../notifications/notificationDeliveryService";
import { notifyAdmins, notifyAdminsEmail } from "../notificationService";
import { reviewInviteService } from "../reviewInvite/reviewInviteService";
import { invalidateCouponCaches } from "../coupon/couponCacheService";
import { invalidateSaleCaches } from "../sale/saleCacheService";
import { razorpayInstance } from "../razorpay";
import { incrementVariantStock, logStockMovement } from "../inventoryService";
import { refProductId } from "../../types/utils/productStock";
import { PAYMENT_QUERY_MAX_MS } from "../../constants/paymentQuery";
import {
  advanceJobBatchCursor,
  getJobBatchCursor,
} from "../../jobs/jobBatchCursor";
import { shouldSendJobAlert } from "../../jobs/jobAlertDedupe";

interface RazorpayPaymentListItem {
  id: string;
  status: string;
}

type RazorpayPaymentCheck = "paid" | "unpaid" | "unknown";

/** Fail-safe: API errors → unknown (never auto-cancel on Razorpay outage). */
async function checkRazorpayPaymentStatus(
  razorpayOrderId: string,
): Promise<RazorpayPaymentCheck> {
  try {
    const payments = (await razorpayInstance.orders.fetchPayments(
      razorpayOrderId,
    )) as { items?: RazorpayPaymentListItem[] };
    const paid = (payments.items ?? []).some(
      (p) => p.status === "captured" || p.status === "authorized",
    );
    return paid ? "paid" : "unpaid";
  } catch (err: unknown) {
    logger.warn({
      msg: "razorpay_payment_check_failed",
      razorpayOrderId,
      error: err instanceof Error ? err.message : "check failed",
    });
    return "unknown";
  }
}

/** Abandoned carts inactive 2+ hours → recovery email/push. */
export async function runAbandonedCartRecoveryJob(): Promise<number> {
  const inactiveMs = Number(
    process.env.CART_ABANDON_INACTIVE_MS || 2 * 60 * 60 * 1000,
  );
  const cooldownMs = Number(
    process.env.CART_ABANDON_COOLDOWN_MS || 24 * 60 * 60 * 1000,
  );
  const batch = Number(process.env.CART_ABANDON_BATCH || 50);
  const cutoff = new Date(Date.now() - inactiveMs);
  const cooldownSince = new Date(Date.now() - cooldownMs);

  const cursor = await getJobBatchCursor("abandoned-cart-recovery");
  const staleCarts = await Cart.find({
    "items.0": { $exists: true },
    total: { $gt: 0 },
    updatedAt: { $lt: cutoff },
    ...(cursor ? { _id: { $gt: cursor } } : {}),
  })
    .populate("user", "name email isActive")
    .sort({ _id: 1 })
    .limit(batch)
    .lean()
    .maxTimeMS(8000);

  await advanceJobBatchCursor(
    "abandoned-cart-recovery",
    staleCarts,
    batch,
    (row) => String((row as { _id: unknown })._id),
  );

  const eligibleUserIds = staleCarts
    .map((cart) => {
      const user = cart.user as unknown as {
        _id?: unknown;
        isActive?: boolean;
        email?: string;
      };
      const userId = String(user?._id ?? cart.user ?? "");
      if (!userId || user?.isActive === false || !user?.email) return null;
      return userId;
    })
    .filter((id): id is string => Boolean(id));

  const recentRecoveryUsers = eligibleUserIds.length
    ? await CartRecoveryLog.find({
        user: { $in: eligibleUserIds },
        sentAt: { $gte: cooldownSince },
      })
        .select("user")
        .lean()
    : [];
  const recentRecoverySet = new Set(
    recentRecoveryUsers.map((r) => String(r.user)),
  );

  let sent = 0;
  for (const cart of staleCarts) {
    const user = cart.user as unknown as {
      _id?: unknown;
      name?: string;
      email?: string;
      isActive?: boolean;
    };
    const userId = String(user?._id ?? cart.user ?? "");
    if (!userId || user?.isActive === false || !user?.email) continue;
    if (recentRecoverySet.has(userId)) continue;

    const itemCount = cart.items?.length ?? 0;
    const cartTotal = cart.total ?? 0;
    const tpl = emailTemplates.abandonedCart(
      user.name || "there",
      cartTotal,
      itemCount,
    );
    await enqueueEmail({ to: user.email!, subject: tpl.subject, html: tpl.html });
    const pushBody = `You left ${itemCount} item${itemCount !== 1 ? "s" : ""} in your cart. Complete checkout before they sell out.`;
    await queuePushForUser(
      {
        userId,
        title: "Your cart is waiting",
        body: pushBody,
        link: "/cart",
      },
      { category: "promotion", skipPreferenceCheck: false },
    ).catch(() => {});

    await CartRecoveryLog.create({
      user: userId,
      sentAt: new Date(),
      channel: "both",
      cartTotal: cart.total ?? 0,
      itemCount,
    });
    sent += 1;
  }
  return sent;
}

/** Auto-cancel stale unpaid Razorpay orders + restore reserved stock. */
export async function runUnpaidOrderAutoCancelJob(): Promise<number> {
  const minAgeMs = Number(
    process.env.UNPAID_ORDER_CANCEL_AFTER_MS || 30 * 60 * 1000,
  );
  const batch = Number(process.env.UNPAID_ORDER_CANCEL_BATCH || 25);
  const cutoff = new Date(Date.now() - minAgeMs);

  const cursor = await getJobBatchCursor("unpaid-order-auto-cancel");
  const stale = await Order.find({
    paymentMethod: "razorpay",
    paymentStatus: "pending",
    status: { $in: ["pending", "confirmed"] },
    updatedAt: { $lt: cutoff },
    ...(cursor ? { _id: { $gt: cursor } } : {}),
  })
    .sort({ _id: 1 })
    .limit(batch)
    .maxTimeMS(PAYMENT_QUERY_MAX_MS);

  await advanceJobBatchCursor(
    "unpaid-order-auto-cancel",
    stale,
    batch,
    (row) => String((row as { _id: unknown })._id),
  );

  let cancelled = 0;
  for (const order of stale) {
    if (order.razorpayOrderId) {
      const paymentStatus = await checkRazorpayPaymentStatus(
        order.razorpayOrderId,
      );
      if (paymentStatus !== "unpaid") continue;
    }

    const claimed = await Order.findOneAndUpdate(
      {
        _id: order._id,
        paymentStatus: "pending",
        status: { $in: ["pending", "confirmed"] },
      },
      {
        $set: { status: "cancelled", paymentStatus: "failed" },
        $push: {
          statusHistory: {
            status: "cancelled",
            timestamp: new Date(),
            note: "Auto-cancelled: payment not received within timeout",
          },
        },
      },
      { new: true },
    );
    if (!claimed) continue;

    if (claimed.inventoryReserved) {
      for (const item of claimed.items) {
        const pid = refProductId(item.product);
        await incrementVariantStock(pid, item.variant.sku, item.quantity, {
          soldCountDelta: -item.quantity,
        });
        await logStockMovement(pid, item.variant.sku, item.quantity, {
          reason: "sale_return",
          referenceId: String(claimed._id),
          referenceType: "order",
          note: `Auto-cancel unpaid order ${claimed.orderNumber}`,
        });
      }
      claimed.inventoryReserved = false;
      await claimed.save();
    }

    cancelled += 1;
  }

  await CheckoutPaymentIntent.updateMany(
    {
      consumedAt: null,
      createdAt: { $lt: cutoff },
    },
    { $set: { consumedAt: new Date() } },
  );

  return cancelled;
}

/** Delivered orders 3+ days old without review invite email → send invite. */
import { isCustomerDeliverableEmail } from "../../types/utils/customerEmail";

export async function runReviewInviteJob(): Promise<number> {
  const delayMs = Number(
    process.env.REVIEW_INVITE_DELAY_MS || 3 * 24 * 60 * 60 * 1000,
  );
  const batch = Number(process.env.REVIEW_INVITE_BATCH || 30);
  const deliveredBefore = new Date(Date.now() - delayMs);

  const cursor = await getJobBatchCursor("review-invite");
  const orders = await Order.find({
    status: "delivered",
    deliveredAt: { $lte: deliveredBefore, $ne: null },
    reviewInviteSkippedAt: null,
    $or: [{ offlineMeta: { $exists: false } }, { offlineMeta: null }],
    ...(cursor ? { _id: { $gt: cursor } } : {}),
  })
    .populate("user", "email")
    .select("_id deliveredAt user offlineMeta")
    .sort({ _id: 1 })
    .limit(batch)
    .lean()
    .maxTimeMS(8000);

  await advanceJobBatchCursor(
    "review-invite",
    orders,
    batch,
    (row) => String((row as { _id: unknown })._id),
  );

  const skipIds: string[] = [];
  const eligible = orders.filter((row) => {
    const user = row.user as unknown as { email?: string } | null;
    const email = user?.email;
    if (!isCustomerDeliverableEmail(email)) {
      skipIds.push(String(row._id));
      return false;
    }
    return true;
  });

  if (skipIds.length) {
    await Order.updateMany(
      { _id: { $in: skipIds } },
      { $set: { reviewInviteSkippedAt: new Date() } },
    );
  }

  let sent = 0;
  for (const row of eligible) {
    const orderId = String(row._id);
    const existing = await ReviewInvite.findOne({
      order: orderId,
      emailSentAt: { $ne: null },
      revokedAt: null,
    })
      .select("_id")
      .lean();
    if (existing) continue;

    try {
      await reviewInviteService.sendInviteEmail(orderId);
      sent += 1;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "invite failed";
      if (message.includes("No customer email")) {
        await Order.updateOne(
          { _id: orderId },
          { $set: { reviewInviteSkippedAt: new Date() } },
        );
      }
      logger.warn({ msg: "review_invite_job_skip", orderId, error: message });
    }
  }
  return sent;
}

/** Expired coupons → isActive=false. */
export async function runCouponExpiryCleanupJob(): Promise<number> {
  const now = new Date();
  const result = await Coupon.updateMany(
    {
      isActive: true,
      expiryDate: { $lt: now, $ne: null },
    },
    { $set: { isActive: false } },
  );
  if (result.modifiedCount > 0) {
    await invalidateCouponCaches();
  }
  return result.modifiedCount;
}

/** Ended sale campaigns → isActive=false. */
export async function runSaleCampaignExpireJob(): Promise<number> {
  const now = new Date();
  const result = await SaleCampaign.updateMany(
    {
      isActive: true,
      endDate: { $lte: now },
      deletedAt: null,
    },
    { $set: { isActive: false } },
  );
  if (result.modifiedCount > 0) {
    await invalidateSaleCaches();
  }
  return result.modifiedCount;
}

/** Move stuck outbox rows to dead_letter and alert admins. */
export async function runOutboxDeadLetterHandlerJob(): Promise<number> {
  const minAttempts = Number(process.env.OUTBOX_DLQ_MIN_ATTEMPTS || 5);
  let total = 0;
  const summary: string[] = [];

  const handlers: Array<{
    type: string;
    findStuck: () => Promise<
      Array<{ _id: unknown; dedupeKey?: string; attempts?: number; lastError?: string }>
    >;
    markDead: (ids: unknown[]) => Promise<unknown>;
  }> = [
    {
      type: "order",
      findStuck: () =>
        OrderEventOutbox.find({
          status: { $in: ["pending", "failed", "processing"] },
          attempts: { $gte: minAttempts },
        })
          .select("_id dedupeKey attempts lastError")
          .limit(100)
          .lean(),
      markDead: (ids) =>
        OrderEventOutbox.updateMany(
          { _id: { $in: ids } },
          { $set: { status: "dead_letter" } },
        ),
    },
    {
      type: "cart",
      findStuck: () =>
        CartEventOutbox.find({
          status: { $in: ["pending", "failed", "processing"] },
          attempts: { $gte: minAttempts },
        })
          .select("_id dedupeKey attempts lastError")
          .limit(100)
          .lean(),
      markDead: (ids) =>
        CartEventOutbox.updateMany(
          { _id: { $in: ids } },
          { $set: { status: "dead_letter" } },
        ),
    },
    {
      type: "inventory",
      findStuck: () =>
        InventoryEventOutbox.find({
          status: { $in: ["pending", "failed", "processing"] },
          attempts: { $gte: minAttempts },
        })
          .select("_id dedupeKey attempts lastError")
          .limit(100)
          .lean(),
      markDead: (ids) =>
        InventoryEventOutbox.updateMany(
          { _id: { $in: ids } },
          { $set: { status: "dead_letter" } },
        ),
    },
    {
      type: "coupon",
      findStuck: () =>
        CouponBroadcastOutbox.find({
          status: { $in: ["pending", "failed", "processing"] },
          attempts: { $gte: minAttempts },
        })
          .select("_id dedupeKey attempts lastError")
          .limit(100)
          .lean(),
      markDead: (ids) =>
        CouponBroadcastOutbox.updateMany(
          { _id: { $in: ids } },
          { $set: { status: "dead_letter" } },
        ),
    },
    {
      type: "gifting",
      findStuck: () =>
        GiftingEventOutbox.find({
          status: { $in: ["pending", "failed", "processing"] },
          attempts: { $gte: minAttempts },
        })
          .select("_id dedupeKey attempts lastError")
          .limit(100)
          .lean(),
      markDead: (ids) =>
        GiftingEventOutbox.updateMany(
          { _id: { $in: ids } },
          { $set: { status: "dead_letter" } },
        ),
    },
    {
      type: "push",
      findStuck: () =>
        PushNotificationOutbox.find({
          status: { $in: ["pending", "failed", "processing"] },
          attempts: { $gte: minAttempts },
        })
          .select("_id dedupeKey attempts lastError")
          .limit(100)
          .lean(),
      markDead: (ids) =>
        PushNotificationOutbox.updateMany(
          { _id: { $in: ids } },
          { $set: { status: "dead_letter" } },
        ),
    },
    {
      type: "blog_publish",
      findStuck: () =>
        BlogPublishOutbox.find({
          status: { $in: ["pending", "failed", "processing"] },
          attempts: { $gte: minAttempts },
        })
          .select("_id dedupeKey attempts lastError")
          .limit(100)
          .lean(),
      markDead: (ids) =>
        BlogPublishOutbox.updateMany(
          { _id: { $in: ids } },
          { $set: { status: "dead_letter" } },
        ),
    },
  ];

  for (const { type, findStuck, markDead } of handlers) {
    const stuck = await findStuck();
    if (!stuck.length) continue;

    await markDead(stuck.map((r) => r._id));

    total += stuck.length;
    summary.push(`${type}:${stuck.length}`);
    for (const row of stuck) {
      logger.error({
        msg: "outbox_dead_letter_handler",
        outboxType: type,
        outboxId: String(row._id),
        dedupeKey: row.dedupeKey,
        attempts: row.attempts,
        error: row.lastError,
      });
    }
  }

  if (total > 0) {
    const alertCooldownMs = Number(
      process.env.OUTBOX_DLQ_ALERT_COOLDOWN_MS || 2 * 60 * 60 * 1000,
    );
    const canAlert = await shouldSendJobAlert(
      "outbox-dead-letter",
      alertCooldownMs,
    );
    if (canAlert) {
      await notifyAdmins(
        "Outbox dead-letter alert",
        `${total} outbox message(s) moved to dead_letter (${summary.join(", ")}). Check logs and Bull Board.`,
        "/admin/system/outbox",
        "alert",
      );
      await notifyAdminsEmail(
        "Outbox dead-letter alert — The House of Rani",
        `<p>${total} outbox message(s) were stuck after ${minAttempts}+ failures and moved to <b>dead_letter</b>.</p><p>Types: ${summary.join(", ")}</p>`,
      );
    }
  }

  return total;
}
