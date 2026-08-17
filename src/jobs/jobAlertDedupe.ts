import { redisConnection, redisEnabled } from "../config/redis";
import logger from "../types/utils/logger";

const memoryCooldowns = new Map<string, number>();

/**
 * Returns true when an alert may be sent (not within cooldown window).
 * Uses Redis PX lock when available; in-memory fallback for dev.
 */
export async function shouldSendJobAlert(
  alertKey: string,
  cooldownMs: number,
): Promise<boolean> {
  const key = `job:alert:cooldown:${alertKey}`;
  const now = Date.now();

  if (!redisEnabled) {
    const until = memoryCooldowns.get(key) ?? 0;
    if (now < until) return false;
    memoryCooldowns.set(key, now + cooldownMs);
    return true;
  }

  try {
    const acquired = await redisConnection.set(
      key,
      "1",
      "PX",
      cooldownMs,
      "NX",
    );
    return acquired === "OK";
  } catch (err: unknown) {
    logger.warn({
      msg: "job_alert_dedupe_error",
      alertKey,
      error: (err as Error).message,
    });
    return true;
  }
}
