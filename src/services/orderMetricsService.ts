import { redisEnabled, redisConnection } from "../config/redis";
import logger from "../types/utils/logger";
import { getRequestContext } from "../types/utils/requestContext";

export type OrderMetricName =
  | "order.fetch.list"
  | "order.fetch.detail"
  | "order.cancel.request"
  | "order.cancel.success"
  | "order.cancel.idempotent"
  | "order.cancel.rejected"
  | "order.cancel.queue_failure"
  | "order.cache.invalidate_ms"
  | "order.outbox.dispatch_failure";

type Labels = Record<string, string | number | boolean | undefined>;

const METRIC_PREFIX = "metrics:orders:";

export function recordOrderMetric(
  name: OrderMetricName,
  labels: Labels = {},
  value = 1,
): void {
  const ctx = getRequestContext();
  logger.info({
    type: "metric",
    metric: name,
    value,
    requestId: ctx?.requestId,
    ...labels,
  });

  if (!redisEnabled) return;
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

export function recordOrderTiming(
  name: OrderMetricName,
  durationMs: number,
  labels: Labels = {},
): void {
  recordOrderMetric(name, { ...labels, durationMs: Math.round(durationMs) }, 1);
}
