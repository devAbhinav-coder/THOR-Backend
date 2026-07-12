import webpush from "web-push";
import { PushSubscriptionModel } from "../models/PushSubscription";
import logger from "../types/utils/logger";
import { sendExpoPushToUser } from "./expoPushService";

const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY || "";
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY || "";
const VAPID_SUBJECT =
  process.env.VAPID_SUBJECT || "mailto:support@thehouseofrani.com";

let configured = false;
if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
  configured = true;
}

export function getVapidPublicKey(): string {
  return VAPID_PUBLIC_KEY;
}

export function isWebPushConfigured(): boolean {
  return configured;
}

/** Subscription is permanently invalid (gone, or signed with different VAPID keys). */
function isStaleWebPushSubscription(err: unknown): boolean {
  const statusCode = Number((err as { statusCode?: number })?.statusCode || 0);
  if (statusCode === 404 || statusCode === 410) return true;
  if (statusCode !== 403) return false;
  const body = String((err as { body?: string })?.body || "").toLowerCase();
  return (
    body.includes("vapid") ||
    body.includes("credentials") ||
    body.includes("authorization header")
  );
}

export async function sendWebPushToUser(
  userId: string,
  payload: { title: string; body: string; link?: string; tag?: string },
): Promise<void> {
  await sendExpoPushToUser(userId, payload).catch((err) =>
    logger.error("Expo push send failed", { userId, err }),
  );

  if (!configured) return;
  const subs = await PushSubscriptionModel.find({
    user: userId,
    isActive: true,
  })
    .lean()
    .maxTimeMS(5000);
  if (!subs.length) return;

  const message = JSON.stringify({
    title: payload.title,
    body: payload.body,
    link: payload.link || "/",
    tag: payload.tag || "in-app-notification",
    icon: "/favicon/web-app-manifest-192x192.png",
    badge: "/favicon/favicon-96x96.png",
  });

  await Promise.all(
    subs.map(async (sub) => {
      try {
        await webpush.sendNotification(
          {
            endpoint: sub.endpoint,
            expirationTime: sub.expirationTime ?? null,
            keys: sub.keys,
          },
          message,
          { TTL: 60 * 60 * 24 },
        );
        await PushSubscriptionModel.updateOne(
          { endpoint: sub.endpoint },
          { lastUsedAt: new Date() },
        ).catch(() => {});
      } catch (err: unknown) {
        if (isStaleWebPushSubscription(err)) {
          await PushSubscriptionModel.updateOne(
            { endpoint: sub.endpoint },
            { isActive: false },
          );
          const { trackInvalidPushToken } =
            await import("./notifications/pushDeliveryTrackingService");
          void trackInvalidPushToken("web");
          logger.info("Deactivated stale web push subscription", {
            userId,
            endpoint: sub.endpoint,
          });
          return;
        }
        logger.error("Web push send failed", {
          userId,
          endpoint: sub.endpoint,
          err,
        });
      }
    }),
  );
}
