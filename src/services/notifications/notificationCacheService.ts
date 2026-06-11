import { redisConnection, redisEnabled } from "../../config/redis";
import { getCache, setCache, deleteCache } from "../cacheService";
import logger from "../../types/utils/logger";
import { getRequestContext } from "../../types/utils/requestContext";

const VERSION_TTL_SEC = 60 * 60 * 24 * 30;
const UNREAD_TTL_SEC = 120;
const PAGE_TTL_SEC = 60;

function versionKey(userId: string): string {
  return `cache:notif:ver:${userId}`;
}

function unreadKey(userId: string, version: number): string {
  return `cache:notif:unread:${userId}:v${version}`;
}

function pageKey(
  userId: string,
  version: number,
  page: number,
  limit: number,
  isRead?: boolean,
): string {
  const readPart =
    isRead === undefined ? "all"
    : isRead ? "read"
    : "unread";
  return `cache:notif:page:${userId}:v${version}:${page}:${limit}:${readPart}`;
}

export async function getNotificationCacheVersion(
  userId: string,
): Promise<number> {
  if (!redisEnabled) return 0;
  const raw = await redisConnection.get(versionKey(userId));
  if (!raw) return 0;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) ? n : 0;
}

export async function bumpNotificationCacheVersion(
  userId: string,
): Promise<number> {
  if (!redisEnabled) return 0;
  const next = await redisConnection.incr(versionKey(userId));
  await redisConnection.expire(versionKey(userId), VERSION_TTL_SEC);
  return next;
}

export function scheduleInvalidateNotificationCache(userId: string): void {
  invalidateNotificationCache(userId).catch((err: Error) => {
    const ctx = getRequestContext();
    logger.warn({
      msg: "notification_cache_invalidation_failed",
      userId,
      requestId: ctx?.requestId,
      error: err.message,
    });
  });
}

export async function invalidateNotificationCache(
  userId: string,
): Promise<void> {
  await bumpNotificationCacheVersion(userId);
}

export async function getCachedUnreadCount(
  userId: string,
): Promise<number | null> {
  const version = await getNotificationCacheVersion(userId);
  return getCache<number>(unreadKey(userId, version));
}

export async function setCachedUnreadCount(
  userId: string,
  count: number,
): Promise<void> {
  const version = await getNotificationCacheVersion(userId);
  await setCache(unreadKey(userId, version), count, UNREAD_TTL_SEC);
}

export async function getCachedNotificationPage<T>(params: {
  userId: string;
  page: number;
  limit: number;
  isRead?: boolean;
}): Promise<T | null> {
  const version = await getNotificationCacheVersion(params.userId);
  return getCache<T>(
    pageKey(params.userId, version, params.page, params.limit, params.isRead),
  );
}

export async function setCachedNotificationPage<T>(
  params: {
    userId: string;
    page: number;
    limit: number;
    isRead?: boolean;
  },
  payload: T,
): Promise<void> {
  const version = await getNotificationCacheVersion(params.userId);
  await setCache(
    pageKey(params.userId, version, params.page, params.limit, params.isRead),
    payload,
    PAGE_TTL_SEC,
  );
}

export async function deleteUserNotificationDetailCache(
  userId: string,
): Promise<void> {
  if (!redisEnabled) return;
  const version = await getNotificationCacheVersion(userId);
  await deleteCache(unreadKey(userId, version));
}
