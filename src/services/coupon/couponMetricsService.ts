import { redisEnabled, redisConnection } from "../../config/redis";
import logger from "../../types/utils/logger";
import { getRequestContext } from "../../types/utils/requestContext";

export type CouponMetricName =
  | "coupon.validate.success"
  | "coupon.validate.failure"
  | "coupon.eligible.fetch"
  | "coupon.redeem.success"
  | "coupon.redeem.race"
  | "coupon.redeem.idempotent"
  | "coupon.broadcast.enqueued"
  | "coupon.broadcast.outbox_failure"
  | "coupon.abuse.suspicious"
  | "coupon.admin.create"
  | "coupon.admin.update"
  | "coupon.admin.deactivate";

type Labels = Record<string, string | number | boolean | undefined>;

const METRIC_PREFIX = "metrics:coupons:";

export function recordCouponMetric(
  name: CouponMetricName,
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
