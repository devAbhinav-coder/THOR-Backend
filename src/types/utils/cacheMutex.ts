import { redisConnection } from "../../config/redis";
import logger from "./logger";

/**
 * Simple Redis‑based mutex to prevent cache stampede.
 *
 * Usage:
 *   const mutex = new CacheMutex('product:slug:my-slug');
 *   const lock = await mutex.acquire();
 *   if (lock) {
 *     try {
 *       // compute expensive value
 *     } finally {
 *       await mutex.release();
 *     }
 *   } else {
 *     // another request is already computing, wait a bit and retry cache
 *   }
 */
export class CacheMutex {
  private readonly key: string;
  private readonly ttlMs: number;
  private readonly retryDelayMs: number;
  private readonly maxRetries: number;

  constructor(
    cacheKey: string,
    options?: {
      ttlMs?: number; // lock duration (default 10s)
      retryDelayMs?: number; // delay between retries (default 100ms)
      maxRetries?: number; // max retries before giving up (default 3)
    },
  ) {
    this.key = `mutex:${cacheKey}`;
    this.ttlMs = options?.ttlMs ?? 10_000;
    this.retryDelayMs = options?.retryDelayMs ?? 100;
    this.maxRetries = options?.maxRetries ?? 3;
  }

  /**
   * Try to acquire the lock. Returns true if acquired, false if already locked.
   * Implements a simple retry loop with exponential backoff.
   */
  async acquire(): Promise<boolean> {
    for (let attempt = 0; attempt < this.maxRetries; attempt++) {
      const acquired = await redisConnection.set(
        this.key,
        "1",
        "PX",
        this.ttlMs,
        "NX",
      );
      if (acquired === "OK") {
        return true;
      }
      if (attempt < this.maxRetries - 1) {
        const delay = this.retryDelayMs * Math.pow(2, attempt);
        await new Promise((r) => setTimeout(r, delay));
      }
    }
    return false;
  }

  /**
   * Release the lock. Safe to call even if lock wasn't acquired.
   */
  async release(): Promise<void> {
    try {
      await redisConnection.del(this.key);
    } catch (e) {
      logger.warn(
        `CacheMutex release failed for ${this.key}: ${(e as Error).message}`,
      );
    }
  }

  /**
   * Execute `fn` under the mutex. If lock cannot be acquired within retries,
   * returns `null` and the caller should fall back to stale cache or other logic.
   */
  async withLock<T>(fn: () => Promise<T>): Promise<T | null> {
    const acquired = await this.acquire();
    if (!acquired) {
      return null;
    }
    try {
      return await fn();
    } finally {
      await this.release();
    }
  }
}

/**
 * Stale‑while‑revalidate helper.
 *
 * 1. Return stale cached value immediately.
 * 2. If cache is older than `staleMs`, try to acquire mutex and recompute.
 * 3. If mutex acquired, compute new value, update cache, return new value.
 * 4. If mutex not acquired, another request is already recomputing; keep serving stale.
 */
export async function staleWhileRevalidate<T>(
  cacheKey: string,
  staleMs: number,
  fetchFresh: () => Promise<T>,
  getCached: (key: string) => Promise<{ value: T; timestamp: number } | null>,
  setCached: (key: string, value: T) => Promise<void>,
): Promise<T> {
  const cached = await getCached(cacheKey);
  const now = Date.now();
  const isStale = !cached || now - cached.timestamp > staleMs;

  if (!isStale) {
    return cached.value;
  }

  // Stale: try to refresh in background
  const mutex = new CacheMutex(cacheKey, { ttlMs: 5000 });
  const refresh = async () => {
    const fresh = await fetchFresh();
    await setCached(cacheKey, fresh);
    return fresh;
  };

  // Non‑blocking refresh attempt
  mutex
    .withLock(refresh)
    .catch((e) =>
      logger.warn(
        `SWR background refresh failed for ${cacheKey}: ${(e as Error).message}`,
      ),
    );

  // Return stale value while refresh runs in background
  return cached?.value ?? refresh();
}
