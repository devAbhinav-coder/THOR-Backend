import { redisEnabled, redisConnection } from '../../config/redis';
import logger from '../../utils/logger';
import { getRequestContext } from '../../utils/requestContext';

export type CartMetricName =
  | 'cart.fetch'
  | 'cart.fetch.cache_hit'
  | 'cart.fetch.cache_miss'
  | 'cart.item.added'
  | 'cart.item.updated'
  | 'cart.item.removed'
  | 'cart.cleared'
  | 'cart.coupon.applied'
  | 'cart.coupon.apply_failed'
  | 'cart.coupon.removed'
  | 'cart.idempotency.replay'
  | 'cart.lock.contention'
  | 'cart.version.conflict'
  | 'cart.abuse.suspicious'
  | 'cart.stale.recovered'
  | 'cart.outbox.dispatch_failure';

type Labels = Record<string, string | number | boolean | undefined>;

const METRIC_PREFIX = 'metrics:cart:';

export function recordCartMetric(
  name: CartMetricName,
  labels: Labels = {},
  value = 1
): void {
  const ctx = getRequestContext();
  logger.info({
    type: 'metric',
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
    .join(',');
  const key = `${METRIC_PREFIX}${name}:${day}${labelKey ? `:${labelKey}` : ''}`;
  if (value === 1) {
    redisConnection.incr(key).catch(() => {});
  } else {
    redisConnection.call('INCRBY', key, String(value)).catch(() => {});
  }
  redisConnection.expire(key, 60 * 60 * 24 * 14).catch(() => {});
}
