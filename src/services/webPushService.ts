import webpush from "web-push";
import { PushSubscriptionModel } from "../models/PushSubscription";
import logger from "../utils/logger";

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

export async function sendWebPushToUser(
  userId: string,
  payload: { title: string; body: string; link?: string; tag?: string },
): Promise<void> {
  if (!configured) return;
  const subs = await PushSubscriptionModel.find({
    user: userId,
    isActive: true,
  }).lean();
  if (!subs.length) return;

  const message = JSON.stringify({
    title: payload.title,
    body: payload.body,
    link: payload.link || "/",
    tag: payload.tag || "in-app-notification",
    icon: "/favicon.png",
    badge: "/favicon.png",
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
      } catch (err: unknown) {
        const statusCode = Number(
          (err as { statusCode?: number })?.statusCode || 0,
        );
        if (statusCode === 404 || statusCode === 410) {
          await PushSubscriptionModel.updateOne(
            { endpoint: sub.endpoint },
            { isActive: false },
          );
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
