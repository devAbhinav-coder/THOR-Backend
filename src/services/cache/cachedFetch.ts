import { CacheMutex } from "../../types/utils/cacheMutex";
import { coalesceInFlight } from "../../types/utils/inFlightCoalesce";
import { isRedisOperational } from "../../config/redis";
import logger from "../../types/utils/logger";
import {
  getCacheEnvelope,
  setCacheEnvelope,
  isEnvelopeFresh,
  isEnvelopeStaleButValid,
  type CacheEnvelope,
} from "./cacheEnvelope";
import { recordPlatformMetric } from "../observability/platformMetricsService";

function metricKeyLabel(key: string): { keyPrefix: string } {
  const prefix = key.split(":").slice(0, 4).join(":");
  return { keyPrefix: prefix || key.slice(0, 48) };
}

export type CachedFetchOptions<T> = {
  key: string;
  softTtlSec: number;
  hardTtlSec: number;
  fetchFresh: () => Promise<T>;
  /** Process-local coalescing (default true). */
  coalesce?: boolean;
  /** Redis SET NX when Redis is operational (default true). */
  distributedLock?: boolean;
};

const PEER_POLL_MS = 50;
const PEER_MAX_WAIT_MS = 2000;

export async function waitForCacheEnvelope<T>(
  key: string,
  maxWaitMs = PEER_MAX_WAIT_MS,
): Promise<T | null> {
  const deadline = Date.now() + maxWaitMs;
  while (Date.now() < deadline) {
    const envelope = await getCacheEnvelope<T>(key);
    if (envelope) {
      return envelope.data;
    }
    await new Promise((r) => setTimeout(r, PEER_POLL_MS));
  }
  return null;
}

async function computeAndStore<T>(opts: CachedFetchOptions<T>): Promise<T> {
  const { key, softTtlSec, hardTtlSec, fetchFresh, distributedLock = true } = opts;

  const useLock = distributedLock && isRedisOperational();
  if (useLock) {
    const mutex = new CacheMutex(key, {
      ttlMs: Math.min(Math.max(softTtlSec * 1000, 3000), 10_000),
      maxRetries: 5,
      retryDelayMs: 40,
    });
    const locked = await mutex.withLock(async () => {
      const again = await getCacheEnvelope<T>(key);
      if (again && (isEnvelopeFresh(again) || isEnvelopeStaleButValid(again))) {
        return again.data;
      }
      recordPlatformMetric("cache.fetch.miss", metricKeyLabel(key));
      const fresh = await fetchFresh();
      if (fresh === null) {
        return fresh as T;
      }
      await setCacheEnvelope(key, fresh, { softTtlSec, hardTtlSec });
      return fresh;
    });
    if (locked !== null) {
      return locked;
    }

    const peer = await waitForCacheEnvelope<T>(key);
    if (peer !== null) {
      return peer;
    }
  }

  recordPlatformMetric("cache.fetch.miss", metricKeyLabel(key));
  const fresh = await fetchFresh();
  if (fresh === null) {
    return fresh as T;
  }
  await setCacheEnvelope(key, fresh, { softTtlSec, hardTtlSec }).catch((err) => {
    logger.warn(`cachedFetch set failed (${key}): ${(err as Error).message}`);
  });
  return fresh;
}

async function refreshCached<T>(opts: CachedFetchOptions<T>): Promise<T> {
  const run = () => computeAndStore(opts);
  if (opts.coalesce === false) {
    return run();
  }
  return coalesceInFlight(`cachedFetch:${opts.key}`, run);
}

/**
 * Cache-aside with soft/hard TTL, stale-while-revalidate, in-flight coalescing, and optional Redis lock.
 */
export async function cachedFetch<T>(opts: CachedFetchOptions<T>): Promise<T> {
  const envelope = await getCacheEnvelope<T>(opts.key);
  const now = Date.now();

  if (envelope && isEnvelopeFresh(envelope, now)) {
    recordPlatformMetric("cache.fetch.hit", metricKeyLabel(opts.key));
    return envelope.data;
  }

  if (envelope && isEnvelopeStaleButValid(envelope, now)) {
    recordPlatformMetric("cache.fetch.stale", metricKeyLabel(opts.key));
    void refreshCached(opts).catch((err) => {
      logger.warn(
        `cachedFetch SWR refresh failed (${opts.key}): ${(err as Error).message}`,
      );
    });
    return envelope.data;
  }

  return refreshCached(opts);
}

/** @internal tests */
export async function readEnvelopeForTests<T>(
  key: string,
): Promise<CacheEnvelope<T> | null> {
  return getCacheEnvelope<T>(key);
}
