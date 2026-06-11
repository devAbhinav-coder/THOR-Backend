import { redisEnabled, redisConnection } from "../../config/redis";
import { recordCouponMetric } from "./couponMetricsService";
import logger from "../../types/utils/logger";
import { getRequestContext } from "../../types/utils/requestContext";

const FAIL_WINDOW_SEC = Number(process.env.COUPON_ABUSE_WINDOW_SEC || 900);
const FAIL_THRESHOLD = Number(process.env.COUPON_ABUSE_FAIL_THRESHOLD || 12);

function failKey(userId: string, ip: string): string {
  return `coupon:abuse:fail:${userId}:${ip}`;
}

export async function recordFailedCouponAttempt(
  userId: string,
  ip: string,
  code: string,
): Promise<void> {
  if (!redisEnabled) return;
  const key = failKey(userId, ip);
  const count = await redisConnection.incr(key);
  if (count === 1) {
    await redisConnection.expire(key, FAIL_WINDOW_SEC);
  }
  if (count >= FAIL_THRESHOLD) {
    const ctx = getRequestContext();
    logger.warn({
      msg: "coupon_abuse_suspicious",
      userId,
      ip,
      code,
      failCount: count,
      requestId: ctx?.requestId,
    });
    recordCouponMetric("coupon.abuse.suspicious", { userId, ip });
  }
}

export async function isCouponValidationThrottled(
  userId: string,
  ip: string,
): Promise<boolean> {
  if (!redisEnabled) return false;
  const raw = await redisConnection.get(failKey(userId, ip));
  if (!raw) return false;
  return Number(raw) >= FAIL_THRESHOLD * 2;
}

export async function clearCouponAbuseCounter(
  userId: string,
  ip: string,
): Promise<void> {
  if (!redisEnabled) return;
  await redisConnection.del(failKey(userId, ip));
}
