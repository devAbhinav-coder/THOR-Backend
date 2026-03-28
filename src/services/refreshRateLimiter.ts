import { redisConnection } from "../config/redis";
import AppError from "../utils/AppError";
import { securityLog } from "../utils/securityLog";

const WINDOW_SEC = parseInt(process.env.REFRESH_TOKEN_WINDOW_SEC || "3600", 10);
const MAX_PER_USER = parseInt(process.env.REFRESH_TOKEN_HOURLY_MAX || "40", 10);
const MAX_PER_IP = parseInt(process.env.REFRESH_TOKEN_IP_HOURLY_MAX || "120", 10);

/**
 * Limits refresh-token rotation per user and per IP to reduce stolen-refresh abuse across instances.
 */
export async function assertRefreshAllowed(userId: string, ip: string): Promise<void> {
  const userKey = `rf:u:${userId}`;
  const ipKey = `rf:ip:${ip}`;

  const u = await redisConnection.incr(userKey);
  if (u === 1) {
    await redisConnection.expire(userKey, WINDOW_SEC);
  }
  if (u > MAX_PER_USER) {
    securityLog("auth.refresh_limited", { reason: "per_user", userId });
    throw new AppError("Too many session refreshes. Please sign in again.", 429);
  }

  const i = await redisConnection.incr(ipKey);
  if (i === 1) {
    await redisConnection.expire(ipKey, WINDOW_SEC);
  }
  if (i > MAX_PER_IP) {
    securityLog("auth.refresh_limited", { reason: "per_ip", ip });
    throw new AppError("Too many session refreshes from this network. Try again later.", 429);
  }
}
