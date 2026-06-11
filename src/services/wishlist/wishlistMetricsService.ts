import { redisEnabled, redisConnection } from "../../config/redis";
import logger from "../../types/utils/logger";
import { getRequestContext } from "../../types/utils/requestContext";

export type WishlistMetricName =
  | "wishlist.fetch"
  | "wishlist.fetch.cache_hit"
  | "wishlist.fetch.cache_miss"
  | "wishlist.toggle.added"
  | "wishlist.toggle.removed"
  | "wishlist.toggle.cap_reached"
  | "wishlist.product.most_wishlisted";

type Labels = Record<string, string | number | boolean | undefined>;

const METRIC_PREFIX = "metrics:wishlist:";

export function recordWishlistMetric(
  name: WishlistMetricName,
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

/** Track product-level wishlist popularity for recommendations/analytics. */
export function recordProductWishlisted(productId: string): void {
  recordWishlistMetric("wishlist.product.most_wishlisted", { productId });
  if (!redisEnabled) return;
  const day = new Date().toISOString().slice(0, 10);
  const key = `${METRIC_PREFIX}top_products:${day}`;
  redisConnection.call("ZINCRBY", key, "1", productId).catch(() => {});
  redisConnection.expire(key, 60 * 60 * 24 * 30).catch(() => {});
}
