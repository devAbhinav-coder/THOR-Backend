import { isRedisOperational, redisConnection, redisEnabled } from "../../config/redis";
import logger from "../../types/utils/logger";
import { getRequestContext } from "../../types/utils/requestContext";

export type PlatformMetricName =
  | "cache.fetch.hit"
  | "cache.fetch.miss"
  | "cache.fetch.stale"
  | "cache.fetch.coalesced"
  | "cache.fetch.lock_wait"
  | "cache.fetch.lock_fail"
  | "auth.user_cache.hit"
  | "auth.user_cache.miss"
  | "db.query.sample";

type Labels = Record<string, string | number | boolean | undefined>;

const METRIC_PREFIX = "metrics:platform:";

export function recordPlatformMetric(
  name: PlatformMetricName,
  labels: Labels = {},
  value = 1,
): void {
  const ctx = getRequestContext();
  logger.info({
    type: "metric",
    metric: name,
    value,
    requestId: ctx?.requestId,
    traceId: ctx?.traceId,
    ...labels,
  });

  if (!redisEnabled || !isRedisOperational()) return;

  const day = new Date().toISOString().slice(0, 10);
  const labelKey = Object.entries(labels)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join(",");
  const key = `${METRIC_PREFIX}${name}:${day}${labelKey ? `:${labelKey}` : ""}`;

  if (value === 1) {
    redisConnection.incr(key).catch(() => {});
  } else {
    redisConnection.call("INCRBY", key, String(value)).catch(() => {});
  }
  redisConnection.expire(key, 60 * 60 * 24 * 14).catch(() => {});
}

export function sampleDbQuery(
  collection: string,
  operation: string,
): void {
  recordPlatformMetric("db.query.sample", { collection, operation });
}
