import crypto from "crypto";
import { redisConnection } from "../config/redis";

const AUTH_VERIFY_IDEMP_PREFIX = "auth:verify:idemp:";
const AUTH_VERIFY_IDEMP_TTL_SEC = 86400;

function idempRedisKey(userId: string, key: string): string {
  const h = crypto.createHash("sha256").update(`${userId}:${key}`).digest("hex");
  return `${AUTH_VERIFY_IDEMP_PREFIX}${h}`;
}

export async function getIdempotentAuthVerifyResponse(
  scopeKey: string,
  idempotencyKey: string,
): Promise<{ statusCode: number; body: unknown } | null> {
  const raw = await redisConnection.get(idempRedisKey(scopeKey, idempotencyKey));
  if (!raw) {
    return null;
  }
  try {
    return JSON.parse(raw) as { statusCode: number; body: unknown };
  } catch {
    return null;
  }
}

export async function setIdempotentAuthVerifyResponse(
  scopeKey: string,
  idempotencyKey: string,
  statusCode: number,
  body: unknown,
): Promise<void> {
  await redisConnection.set(
    idempRedisKey(scopeKey, idempotencyKey),
    JSON.stringify({ statusCode, body }),
    "EX",
    AUTH_VERIFY_IDEMP_TTL_SEC,
  );
}
