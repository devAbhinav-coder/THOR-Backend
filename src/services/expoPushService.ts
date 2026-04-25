import ExpoPushToken from "../models/ExpoPushToken";
import logger from "../utils/logger";

/** Lazy-load ESM-only `expo-server-sdk` from CommonJS (`ts-node` / `require` cannot load it at top level). */
async function loadExpo() {
  const { Expo } = await import("expo-server-sdk");
  return { Expo, client: new Expo() };
}

export async function sendExpoPushToUser(
  userId: string,
  payload: { title: string; body: string; link?: string; tag?: string },
): Promise<void> {
  const docs = await ExpoPushToken.find({ user: userId }).lean();
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
      tickets.forEach((ticket, i) => {
        if (ticket.status === "error") {
          logger.warn("Expo push ticket error", {
            message: ticket.message,
            details: ticket.details,
            token: chunk[i]?.to,
          });
          const err = ticket.details?.error;
          if (err === "DeviceNotRegistered" || err === "InvalidCredentials") {
            const tok = typeof chunk[i]?.to === "string" ? chunk[i].to : "";
            if (tok) {
              void ExpoPushToken.deleteMany({ token: tok }).catch(() => {});
            }
          }
        }
      });
    } catch (e) {
      logger.error("Expo push chunk failed", { err: e, userId });
    }
  }
}
