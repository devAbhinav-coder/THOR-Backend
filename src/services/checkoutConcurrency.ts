import crypto from "crypto";
import { redisConnection } from "../config/redis";

const LOCK_PREFIX = "checkout:lock:";
const LOCK_TTL_SEC = 25;
const IDEMP_PREFIX = "checkout:idemp:";
const IDEMP_TTL_SEC = 86400;
const PAY_VERIFY_PREFIX = "pay:verify:";
const PAY_NOTIFY_PREFIX = "order:paid_notify:";

export function normalizeIdempotencyKey(raw: string | undefined): string | null {
  if (!raw || typeof raw !== "string") {
    return null;
  }
  const t = raw.trim();
  if (t.length < 8 || t.length > 128) {
    return null;
  }
  if (!/^[a-zA-Z0-9_-]+$/.test(t)) {
    return null;
  }
  return t;
}

export async function acquireCheckoutLock(userId: string): Promise<boolean> {
  const r = await redisConnection.set(`${LOCK_PREFIX}${userId}`, "1", "EX", LOCK_TTL_SEC, "NX");
  return r === "OK";
}

export async function releaseCheckoutLock(userId: string): Promise<void> {
  await redisConnection.del(`${LOCK_PREFIX}${userId}`);
}

function idempRedisKey(userId: string, key: string): string {
  const h = crypto.createHash("sha256").update(`${userId}:${key}`).digest("hex");
  return `${IDEMP_PREFIX}${h}`;
}

export async function getIdempotentCheckoutResponse(
  userId: string,
  key: string
): Promise<{ statusCode: number; body: unknown } | null> {
  const raw = await redisConnection.get(idempRedisKey(userId, key));
  if (!raw) {
    return null;
  }
  try {
    return JSON.parse(raw) as { statusCode: number; body: unknown };
  } catch {
    return null;
  }
}

export async function setIdempotentCheckoutResponse(
  userId: string,
  key: string,
  statusCode: number,
  body: unknown
): Promise<void> {
  await redisConnection.set(
    idempRedisKey(userId, key),
    JSON.stringify({ statusCode, body }),
    "EX",
    IDEMP_TTL_SEC
  );
}

export async function acquirePaymentVerifyLock(orderId: string, ttlSec = 45): Promise<boolean> {
  const r = await redisConnection.set(`${PAY_VERIFY_PREFIX}${orderId}`, "1", "EX", ttlSec, "NX");
  return r === "OK";
}

export async function releasePaymentVerifyLock(orderId: string): Promise<void> {
  await redisConnection.del(`${PAY_VERIFY_PREFIX}${orderId}`);
}

/** Ensures "order paid" emails fire once per Razorpay payment id (multi-instance safe). */
export async function tryClaimPaymentPlacedNotification(
  razorpayPaymentId: string,
  ttlSec = 604800
): Promise<boolean> {
  const r = await redisConnection.set(
    `${PAY_NOTIFY_PREFIX}${razorpayPaymentId}`,
    "1",
    "EX",
    ttlSec,
    "NX"
  );
  return r === "OK";
}
