import ExpoPushToken from "../models/ExpoPushToken";
import logger from "../types/utils/logger";

/** Lazy-load ESM-only `expo-server-sdk` from CommonJS (`ts-node` / `require` cannot load it at top level). */
async function loadExpo() {
  const { Expo } = await import("expo-server-sdk");
  return { Expo, client: new Expo() };
}

export async function sendExpoPushToUser(
  userId: string,
  payload: { title: string; body: string; link?: string; tag?: string },
): Promise<void> {
  const docs = await ExpoPushToken.find({
    user: userId,
    isActive: { $ne: false },
  }).lean();
  if (!docs.length) return;

  let Expo: Awaited<ReturnType<typeof loadExpo>>["Expo"];
  let expo: Awaited<ReturnType<typeof loadExpo>>["client"];
  try {
    ({ Expo, client: expo } = await loadExpo());
  } catch (e) {
    logger.error("Failed to load expo-server-sdk", { err: e });
    return;
  }

  const validTokens = docs
    .map((d) => d.token)
    .filter((t) => typeof t === "string" && Expo.isExpoPushToken(t));

  if (!validTokens.length) return;

  const messages = validTokens.map((to) => ({
    to,
    sound: "default" as const,
    title: payload.title,
    body: payload.body,
    data: {
      link: payload.link || "/",
      tag: payload.tag || "in-app-notification",
    },
  }));

  const chunks = expo.chunkPushNotifications(messages);
  for (const chunk of chunks) {
    try {
      const tickets = await expo.sendPushNotificationsAsync(chunk);
      const usedTokens: string[] = [];
      tickets.forEach((ticket, i) => {
        const tok = typeof chunk[i]?.to === "string" ? chunk[i].to : "";
        if (tok) usedTokens.push(tok);
        if (ticket.status === "error") {
          logger.warn("Expo push ticket error", {
            message: ticket.message,
            details: ticket.details,
            token: tok,
          });
          const err = ticket.details?.error;
          if (err === "DeviceNotRegistered" || err === "InvalidCredentials") {
            if (tok) {
              void ExpoPushToken.updateMany(
                { token: tok },
                { isActive: false },
              ).catch(() => {});
              void import("./notifications/pushDeliveryTrackingService").then(
                (m) => m.trackInvalidPushToken("expo"),
              );
            }
          }
        }
      });
      if (usedTokens.length) {
        void ExpoPushToken.updateMany(
          { user: userId, token: { $in: usedTokens } },
          { lastUsedAt: new Date() },
        ).catch(() => {});
      }
    } catch (e) {
      logger.error("Expo push chunk failed", { err: e, userId });
    }
  }
}
