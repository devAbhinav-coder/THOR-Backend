import { redisEnabled, redisConnection } from "../config/redis";
import logger from "../utils/logger";
import { serviceError } from "../auth/authErrors";

const VERIFY_WINDOW_MS = 15 * 60 * 1000;
const VERIFY_WINDOW_SEC = Math.ceil(VERIFY_WINDOW_MS / 1000);
const MAX_VERIFY_FAILS = 10;
const KEY_PREFIX = "otp:verify:fail:";

export async function getOtpVerifyLockoutRetryAfter(
  emailRaw: string,
  flow: string,
  ip: string,
): Promise<number | null> {
  if (!redisEnabled) return null;
  const email = normalizeEmail(emailRaw);
  const key = `${KEY_PREFIX}${flow}:${email}:${ip}`;
  try {
    const raw = await redisConnection.get(key);
    const n = raw ? parseInt(raw, 10) || 0 : 0;
    if (n < MAX_VERIFY_FAILS) return null;
    const ttlRaw = await redisConnection.call("TTL", key);
    const ttl = typeof ttlRaw === "number" ? ttlRaw : parseInt(String(ttlRaw ?? "0"), 10) || 0;
    return ttl > 0 ? ttl : VERIFY_WINDOW_SEC;
  } catch {
    return VERIFY_WINDOW_SEC;
  }
}

function normalizeEmail(email: string): string {
  return email.toLowerCase().trim();
}

/**
 * Brute-force guard for OTP verify attempts (per email+flow+IP).
 */
export async function assertOtpVerifyAllowed(
  emailRaw: string,
  flow: string,
  ip: string,
): Promise<void> {
  if (!redisEnabled) return;

  const email = normalizeEmail(emailRaw);
  const key = `${KEY_PREFIX}${flow}:${email}:${ip}`;

  try {
    const raw = await redisConnection.get(key);
    const n = raw ? parseInt(raw, 10) || 0 : 0;
    if (n >= MAX_VERIFY_FAILS) {
      const ttlRaw = await redisConnection.call("TTL", key);
      const ttl = typeof ttlRaw === "number" ? ttlRaw : parseInt(String(ttlRaw ?? "0"), 10) || 0;
      const retryAfter = ttl > 0 ? ttl : VERIFY_WINDOW_SEC;
      throw serviceError(
        "Too many verification attempts. Please try again later.",
        429,
        retryAfter,
      );
    }
  } catch (e) {
    const err = e as Error & { statusCode?: number };
    if (err.statusCode === 429) throw e;
    logger.warn(`OTP verify throttle read failed: ${err.message}`);
  }
}

export async function recordOtpVerifyFailure(
  emailRaw: string,
  flow: string,
  ip: string,
): Promise<void> {
  if (!redisEnabled) return;

  const email = normalizeEmail(emailRaw);
  const key = `${KEY_PREFIX}${flow}:${email}:${ip}`;

  try {
    const n = await redisConnection.incr(key);
    if (n === 1) {
      await redisConnection.expire(key, Math.ceil(VERIFY_WINDOW_MS / 1000));
    }
  } catch (e) {
    logger.warn(`OTP verify throttle record failed: ${(e as Error).message}`);
  }
}

export async function clearOtpVerifyFailures(
  emailRaw: string,
  flow: string,
  ip: string,
): Promise<void> {
  if (!redisEnabled) return;
  const email = normalizeEmail(emailRaw);
  const key = `${KEY_PREFIX}${flow}:${email}:${ip}`;
  try {
    await redisConnection.del(key);
  } catch {
    /* ignore */
  }
}
