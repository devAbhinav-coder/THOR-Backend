import { redisEnabled, redisConnection } from '../../config/redis';
import logger from '../../utils/logger';
import { getRequestContext } from '../../utils/requestContext';

export type NotificationMetricName =
  | 'notification.fetch.list'
  | 'notification.unread.cache_hit'
  | 'notification.unread.cache_miss'
  | 'notification.mark_read'
  | 'notification.mark_all_read'
  | 'notification.clear_all'
  | 'push.subscribe.web'
  | 'push.subscribe.expo'
  | 'push.unsubscribe.web'
  | 'push.unsubscribe.expo'
  | 'push.delivery.queued'
  | 'push.delivery.success'
  | 'push.delivery.failure'
  | 'push.invalid_token'
  | 'push.outbox.dispatch_failure'
  | 'push.queue.latency_ms';

type Labels = Record<string, string | number | boolean | undefined>;

const METRIC_PREFIX = 'metrics:notifications:';

export function recordNotificationMetric(
  name: NotificationMetricName,
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
