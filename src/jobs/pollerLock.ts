import { randomUUID } from "crypto";
import { redisConnection, redisEnabled } from "../config/redis";
import logger from "../types/utils/logger";

const LOCK_PREFIX = "poller:lock:";

/**
 * Acquire a distributed lock so only one instance runs a poller tick at a time.
 * Falls through without locking when Redis is unavailable (single-instance dev).
 */
export async function withPollerLock<T>(
  pollerName: string,
  ttlMs: number,
  fn: () => Promise<T>,
): Promise<T | null> {
  if (!redisEnabled) {
    return fn();
  }

  const lockKey = `${LOCK_PREFIX}${pollerName}`;
  const token = randomUUID();

  try {
    const acquired = await redisConnection.set(
      lockKey,
      token,
      "PX",
      ttlMs,
      "NX",
    );
    if (acquired !== "OK") {
      return null;
    }

    try {
      return await fn();
    } finally {
      const current = await redisConnection.get(lockKey);
      if (current === token) {
        await redisConnection.del(lockKey);
      }
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "lock error";
    logger.warn({ msg: "poller_lock_error", pollerName, error: message });
    return null;
  }
}

/**
 * Long-running job lock (e.g. embedding backfill). Uses SET NX with TTL;
 * lock auto-expires if the process crashes.
 */
export async function acquireJobLock(
  jobName: string,
  ttlMs: number,
): Promise<string | null> {
  if (!redisEnabled) {
    return "dev-no-redis";
  }

  const lockKey = `${LOCK_PREFIX}job:${jobName}`;
  const token = randomUUID();

  try {
    const acquired = await redisConnection.set(
      lockKey,
      token,
      "PX",
      ttlMs,
      "NX",
    );
    return acquired === "OK" ? token : null;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "lock error";
    logger.warn({ msg: "job_lock_acquire_error", jobName, error: message });
    return null;
  }
}

export async function releaseJobLock(
  jobName: string,
  token: string,
): Promise<void> {
  if (!redisEnabled || token === "dev-no-redis") return;

  const lockKey = `${LOCK_PREFIX}job:${jobName}`;
  try {
    const current = await redisConnection.get(lockKey);
    if (current === token) {
      await redisConnection.del(lockKey);
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "lock release error";
    logger.warn({ msg: "job_lock_release_error", jobName, error: message });
  }
}
