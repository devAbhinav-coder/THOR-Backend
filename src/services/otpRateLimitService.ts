import { redisEnabled, redisConnection } from "../config/redis";
import logger from "../types/utils/logger";
import OtpSendLog from "../models/OtpSendLog";
import { serviceError } from "../auth/authErrors";

const WINDOW_MS = 10 * 60 * 1000;
const MAX_SENDS_PER_WINDOW = 3;
const REDIS_KEY_PREFIX = "otp:send:window:";
export type OtpRateLimitFlow =
  | "signup"
  | "login"
  | "forgot_password"
  | "generic";

function normalizeEmail(email: string): string {
  return email.toLowerCase().trim();
}

/**
 * Redis: sorted set of send timestamps; trim entries older than the window, then count.
 * Mongo fallback: count OtpSendLog rows in the last 10 minutes for this email.
 */
export async function assertOtpSendAllowed(
  emailRaw: string,
  flow: OtpRateLimitFlow = "generic",
): Promise<void> {
  const email = normalizeEmail(emailRaw);
  const now = Date.now();
  const windowStart = now - WINDOW_MS;

  if (redisEnabled) {
    const key = `${REDIS_KEY_PREFIX}${flow}:${email}`;
    try {
      await redisConnection.call(
        "zremrangebyscore",
        key,
        "0",
        String(windowStart),
      );
      const raw = await redisConnection.call("zcard", key);
      const n =
        typeof raw === "number" ? raw : parseInt(String(raw ?? "0"), 10) || 0;
      if (n >= MAX_SENDS_PER_WINDOW) {
        let retryAfter = Math.ceil(WINDOW_MS / 1000);
        try {
          const oldest = (await redisConnection.call(
            "zrange",
            key,
            "0",
            "0",
            "WITHSCORES",
          )) as string[];
          if (oldest?.length >= 2) {
            const oldestMs = parseInt(oldest[1], 10) || now;
            retryAfter = Math.max(
              1,
              Math.ceil((oldestMs + WINDOW_MS - now) / 1000),
            );
          }
        } catch {
          /* use default */
        }
        throw serviceError(
          "Too many verification code requests. Please try again in a few minutes.",
          429,
          retryAfter,
        );
      }
    } catch (e) {
      const err = e as Error & { statusCode?: number };
      if (err.statusCode === 429) throw e;
      logger.warn(
        `OTP rate limit Redis check failed, using DB fallback: ${err.message}`,
      );
      await assertOtpSendAllowedMongo(email, flow, windowStart);
    }
    return;
  }

  await assertOtpSendAllowedMongo(email, flow, windowStart);
}

/** Call after a send is accepted (before delivering mail) to record the attempt. */
export async function recordOtpSend(
  emailRaw: string,
  flow: OtpRateLimitFlow = "generic",
): Promise<void> {
  const email = normalizeEmail(emailRaw);
  const now = Date.now();

  if (redisEnabled) {
    const key = `${REDIS_KEY_PREFIX}${flow}:${email}`;
    try {
      const member = `${now}:${Math.random().toString(36).slice(2)}`;
      await redisConnection.call("zadd", key, String(now), member);
      await redisConnection.call("pexpire", key, String(WINDOW_MS + 60_000));
    } catch (e) {
      logger.warn(
        `OTP rate limit Redis record failed: ${(e as Error).message}`,
      );
      await OtpSendLog.create({ email, flow });
    }
    return;
  }

  await OtpSendLog.create({ email, flow });
}

async function assertOtpSendAllowedMongo(
  email: string,
  flow: OtpRateLimitFlow,
  windowStartMs: number,
): Promise<void> {
  const since = new Date(windowStartMs);
  const n = await OtpSendLog.countDocuments({
    email,
    flow,
    createdAt: { $gte: since },
  });
  if (n >= MAX_SENDS_PER_WINDOW) {
    throw serviceError(
      "Too many verification code requests. Please try again in a few minutes.",
      429,
      Math.ceil(WINDOW_MS / 1000),
    );
  }
}
