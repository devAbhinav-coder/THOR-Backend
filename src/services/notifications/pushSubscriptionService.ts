import { createHash } from "crypto";
import { Types } from "mongoose";
import { PushSubscriptionModel } from "../../models/PushSubscription";
import ExpoPushToken from "../../models/ExpoPushToken";
import AppError from "../../types/utils/AppError";
import { isExpoPushToken } from "../../types/utils/isExpoPushToken";
import { getVapidPublicKey, isWebPushConfigured } from "../webPushService";
import { recordNotificationMetric } from "./notificationMetricsService";
import type {
  ParsedExpoTokenBody,
  ParsedPushSubscriptionBody,
} from "../../validation/notificationSchemas";

const QUERY_MAX_MS = 5000;

function hashValue(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function getWebPushPublicKeyResponse(): {
  enabled: boolean;
  publicKey: string;
} {
  if (!isWebPushConfigured()) {
    return { enabled: false, publicKey: "" };
  }
  return { enabled: true, publicKey: getVapidPublicKey() };
}

export async function saveWebPushSubscription(
  userId: string,
  body: ParsedPushSubscriptionBody,
): Promise<void> {
  if (!isWebPushConfigured()) {
    throw new AppError("Web push is not configured on server.", 503);
  }

  const { subscription } = body;
  const endpointHash = hashValue(subscription.endpoint);

  await PushSubscriptionModel.findOneAndUpdate(
    { endpoint: subscription.endpoint },
    {
      user: new Types.ObjectId(userId),
      endpoint: subscription.endpoint,
      expirationTime: subscription.expirationTime ?? null,
      keys: {
        p256dh: subscription.keys.p256dh,
        auth: subscription.keys.auth,
      },
      isActive: true,
      platform: "web",
      deviceType: "browser",
      lastUsedAt: new Date(),
      endpointHash,
    },
    { upsert: true, new: true, runValidators: true },
  ).maxTimeMS(QUERY_MAX_MS);

  recordNotificationMetric("push.subscribe.web", { userId });
}

export async function removeWebPushSubscription(
  userId: string,
  endpoint: string,
): Promise<void> {
  await PushSubscriptionModel.updateOne(
    { endpoint, user: userId },
    { isActive: false },
  ).maxTimeMS(QUERY_MAX_MS);
  recordNotificationMetric("push.unsubscribe.web", { userId });
}

export function resolveExpoToken(body: ParsedExpoTokenBody): string {
  return String(body.expoPushToken ?? body.token ?? "").trim();
}

export async function saveExpoPushToken(
  userId: string,
  body: ParsedExpoTokenBody,
): Promise<void> {
  const raw = resolveExpoToken(body);
  if (!raw || !isExpoPushToken(raw)) {
    throw new AppError("Invalid Expo push token.", 400);
  }

  const tokenHash = hashValue(raw);
  const platform = body.platform ?? "unknown";

  await ExpoPushToken.findOneAndUpdate(
    { user: userId, token: raw },
    {
      user: userId,
      token: raw,
      isActive: true,
      platform,
      deviceType: body.deviceType?.trim() || platform,
      appVersion: body.appVersion?.trim(),
      lastUsedAt: new Date(),
      tokenHash,
    },
    { upsert: true, new: true, runValidators: true },
  ).maxTimeMS(QUERY_MAX_MS);

  recordNotificationMetric("push.subscribe.expo", { userId, platform });
}

export async function removeExpoPushToken(
  userId: string,
  body: ParsedExpoTokenBody,
): Promise<void> {
  const raw = resolveExpoToken(body);
  if (!raw) {
    throw new AppError("Expo push token is required.", 400);
  }
  await ExpoPushToken.updateMany(
    { user: userId, token: raw },
    { isActive: false },
  ).maxTimeMS(QUERY_MAX_MS);
  recordNotificationMetric("push.unsubscribe.expo", { userId });
}
