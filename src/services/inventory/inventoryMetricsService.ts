import { redisEnabled, redisConnection } from '../../config/redis';
import logger from '../../utils/logger';
import { getRequestContext } from '../../utils/requestContext';

export type InventoryMetricName =
  | 'inventory.stock.adjusted'
  | 'inventory.purchase_invoice.created'
  | 'inventory.purchase_invoice.failed'
  | 'inventory.purchase_invoice.duplicate'
  | 'inventory.bulk_write.mismatch'
  | 'inventory.reconciliation.drift'
  | 'inventory.cache.invalidate_ms'
  | 'inventory.gst_summary.ms'
  | 'inventory.outbox.dispatch_failure';

type Labels = Record<string, string | number | boolean | undefined>;

const METRIC_PREFIX = 'metrics:inventory:';

export function recordInventoryMetric(
  name: InventoryMetricName,
  labels: Labels = {},
  value = 1
): void {
  const ctx = getRequestContext();
  logger.info({
    type: 'metric',
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
    .join(',');
  const key = `${METRIC_PREFIX}${name}:${day}${labelKey ? `:${labelKey}` : ''}`;
  if (value === 1) {
    redisConnection.incr(key).catch(() => {});
  } else {
    redisConnection.call('INCRBY', key, String(value)).catch(() => {});
  }
  redisConnection.expire(key, 60 * 60 * 24 * 14).catch(() => {});
}

export function recordInventoryTiming(
  name: InventoryMetricName,
  durationMs: number,
  labels: Labels = {}
): void {
  recordInventoryMetric(name, { ...labels, durationMs: Math.round(durationMs) }, 1);
}
