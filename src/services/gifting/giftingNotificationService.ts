import User from "../../models/User";
import { emailTemplates } from "../emailService";
import { enqueueEmail } from "../../queues/emailQueue";
import { notifyAdmins, notifyUser } from "../notificationService";
import GiftingEventOutbox, {
  GiftingOutboxEventType,
} from "../../models/GiftingEventOutbox";
import logger from "../../types/utils/logger";
import { getRequestContext } from "../../types/utils/requestContext";
import { recordGiftingMetric } from "./giftingMetricsService";

const MAX_ATTEMPTS = 6;
const BASE_BACKOFF_MS = 2000;

function nextBackoffMs(attempts: number): number {
  return Math.min(BASE_BACKOFF_MS * 2 ** attempts, 30 * 60 * 1000);
}

export async function enqueueGiftingSideEffect(
  eventType: GiftingOutboxEventType,
  payload: Record<string, unknown>,
  dedupeKey: string,
): Promise<void> {
  try {
    const doc = await GiftingEventOutbox.findOneAndUpdate(
      { dedupeKey },
      {
        $setOnInsert: {
          dedupeKey,
          eventType,
          payload,
          status: "pending",
          attempts: 0,
          nextAttemptAt: new Date(),
        },
      },
      { upsert: true, new: true },
    ).lean();

    if (doc?.status === "completed") return;
    scheduleDispatchGiftingOutbox(String(doc?._id ?? ""));
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : "outbox persist failed";
    logger.error({
      msg: "gifting_outbox_persist_failed",
      dedupeKey,
      requestId: getRequestContext()?.requestId,
      error: message,
    });
    recordGiftingMetric("gifting.notification.failure", { phase: "persist" });
  }
}

function scheduleDispatchGiftingOutbox(outboxId: string): void {
  if (!outboxId) return;
  dispatchGiftingOutboxById(outboxId).catch((err: Error) => {
    logger.warn({
      msg: "gifting_outbox_immediate_dispatch_failed",
      outboxId,
      error: err.message,
    });
  });
}

async function executeGiftingOutboxEvent(
  eventType: GiftingOutboxEventType,
  payload: Record<string, unknown>,
): Promise<void> {
  switch (eventType) {
    case "notify_admins": {
      await notifyAdmins(
        String(payload.title),
        String(payload.message),
        String(payload.link ?? "/admin/gifting"),
        (payload.type as "order" | "alert") ?? "order",
      );
      return;
    }
    case "notify_user": {
      await notifyUser(
        payload.userId as string,
        String(payload.title),
        String(payload.message),
        String(payload.link),
        (payload.type as "order") ?? "order",
      );
      return;
    }
    case "email_admin_new_request": {
      const admins = await User.find({ role: "admin", isActive: true })
        .select("email")
        .lean();
      const tpl = emailTemplates.adminNewGiftingRequest(
        String(payload.name),
        String(payload.email),
        String(payload.phone ?? ""),
        String(payload.occasion),
        Number(payload.itemCount),
        payload.proposedPrice as number | undefined,
        String(payload.requestId),
      );
      await Promise.all(
        admins.map((a) =>
          enqueueEmail({ to: a.email, subject: tpl.subject, html: tpl.html }),
        ),
      );
      return;
    }
    case "email_user_quote": {
      const tpl = emailTemplates.customGiftQuote(
        String(payload.userName),
        String(payload.occasion),
        Number(payload.quotedPrice),
        String(payload.deliveryTime ?? "To be confirmed"),
        payload.adminNote as string | undefined,
        String(payload.requestId),
      );
      await enqueueEmail({
        to: String(payload.email),
        subject: tpl.subject,
        html: tpl.html,
      });
      return;
    }
    case "email_user_order_created": {
      const tpl = emailTemplates.customGiftOrderCreated(
        String(payload.userName),
        String(payload.occasion),
        String(payload.orderNumber),
        Number(payload.quotedPrice),
        String(payload.orderId),
      );
      await enqueueEmail({
        to: String(payload.email),
        subject: tpl.subject,
        html: tpl.html,
      });
      return;
    }
    case "email_admin_quote_rejected": {
      const admins = await User.find({ role: "admin", isActive: true })
        .select("email")
        .lean();
      const tpl = emailTemplates.adminCustomGiftRejected(
        String(payload.userName),
        String(payload.occasion),
        String(payload.requestId),
      );
      await Promise.all(
        admins.map((a) =>
          enqueueEmail({ to: a.email, subject: tpl.subject, html: tpl.html }),
        ),
      );
      return;
    }
    case "email_admin_quote_accepted": {
      const admins = await User.find({ role: "admin", isActive: true })
        .select("email")
        .lean();
      const tpl = emailTemplates.adminCustomGiftAccepted(
        String(payload.userName),
        String(payload.occasion),
        String(payload.orderNumber),
        Number(payload.quotedPrice),
        String(payload.orderId),
      );
      await Promise.all(
        admins.map((a) =>
          enqueueEmail({ to: a.email, subject: tpl.subject, html: tpl.html }),
        ),
      );
      return;
    }
    default:
      return;
  }
}

export async function dispatchGiftingOutboxById(
  outboxId: string,
): Promise<boolean> {
  const claimed = await GiftingEventOutbox.findOneAndUpdate(
    {
      _id: outboxId,
      status: { $in: ["pending", "failed"] },
      nextAttemptAt: { $lte: new Date() },
    },
    { $set: { status: "processing" }, $inc: { attempts: 1 } },
    { new: true },
  );

  if (!claimed) return false;

  try {
    await executeGiftingOutboxEvent(
      claimed.eventType,
      claimed.payload as Record<string, unknown>,
    );
    await GiftingEventOutbox.updateOne(
      { _id: claimed._id },
      {
        $set: {
          status: "completed",
          processedAt: new Date(),
          lastError: undefined,
        },
      },
    );
    return true;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "dispatch failed";
    const attempts = claimed.attempts;
    const terminal = attempts >= MAX_ATTEMPTS;
    await GiftingEventOutbox.updateOne(
      { _id: claimed._id },
      {
        $set: {
          status: terminal ? "failed" : "pending",
          lastError: message.slice(0, 500),
          nextAttemptAt: new Date(Date.now() + nextBackoffMs(attempts)),
        },
      },
    );
    recordGiftingMetric("gifting.notification.failure", { terminal, attempts });
    return false;
  }
}

export async function processPendingGiftingOutboxBatch(
  limit = 25,
): Promise<number> {
  const pending = await GiftingEventOutbox.find({
    status: { $in: ["pending", "failed"] },
    nextAttemptAt: { $lte: new Date() },
    attempts: { $lt: MAX_ATTEMPTS },
  })
    .sort({ nextAttemptAt: 1 })
    .limit(limit)
    .select("_id")
    .lean()
    .maxTimeMS(5000);

  let dispatched = 0;
  for (const row of pending) {
    if (await dispatchGiftingOutboxById(String(row._id))) dispatched += 1;
  }
  return dispatched;
}

/** Fire-and-forget side effects (in-app immediate; emails via outbox for retry). */
export function scheduleNewRequestNotifications(params: {
  requestId: string;
  name: string;
  email: string;
  phone?: string;
  occasion: string;
  itemCount: number;
  proposedPrice?: number;
}): void {
  notifyAdmins(
    "New Custom Gift Request",
    `${params.name} submitted a customization request for "${params.occasion}" (${params.itemCount} item${params.itemCount !== 1 ? "s" : ""}).`,
    "/admin/gifting",
    "order",
  ).catch(() => {});

  void enqueueGiftingSideEffect(
    "email_admin_new_request",
    { ...params, itemCount: params.itemCount },
    `gifting:email:admin:new:${params.requestId}`,
  );
}
