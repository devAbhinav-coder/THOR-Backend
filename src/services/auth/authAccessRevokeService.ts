import { redisConnection } from "../../config/redis";
import { accessTokenTtlSeconds } from "../../auth/accessTokenTtl";

const REVOKED_SID_PREFIX = "auth:revoked:sid:";

function revokedSidKey(sessionId: string): string {
  return `${REVOKED_SID_PREFIX}${sessionId}`;
}

export async function revokeAccessSession(
  sessionId: string,
  ttlSec = accessTokenTtlSeconds("user"),
): Promise<void> {
  if (!sessionId?.trim()) return;
  const sec = Math.max(60, Math.min(ttlSec, 86400));
  await redisConnection.set(revokedSidKey(sessionId), "1", "EX", sec);
}

export async function isAccessSessionRevoked(sessionId: string): Promise<boolean> {
  if (!sessionId?.trim()) return false;
  const val = await redisConnection.get(revokedSidKey(sessionId));
  return val === "1";
}
