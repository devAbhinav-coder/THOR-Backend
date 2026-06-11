import { redisEnabled, redisConnection } from "../../config/redis";
import logger from "../../types/utils/logger";
import { getRequestContext } from "../../types/utils/requestContext";

export type ReviewMetricName =
  | "review.featured.fetch"
  | "review.featured.cache_hit"
  | "review.featured.cache_miss"
  | "review.product.list"
  | "review.product.cache_hit"
  | "review.product.cache_miss"
  | "review.created"
  | "review.updated"
  | "review.deleted"
  | "review.duplicate_attempt"
  | "review.helpful.vote"
  | "review.helpful.unvote"
  | "review.reported"
  | "review.spam_blocked"
  | "review.moderation.flagged"
  | "review.idempotency.replay";

type Labels = Record<string, string | number | boolean | undefined>;

const METRIC_PREFIX = "metrics:review:";

export function recordReviewMetric(
  name: ReviewMetricName,
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
