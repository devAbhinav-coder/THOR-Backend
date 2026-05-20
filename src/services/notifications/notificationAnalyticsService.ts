import PushDeliveryRecord from '../../models/PushDeliveryRecord';
import { redisEnabled, redisConnection } from '../../config/redis';
import { recordNotificationMetric, NotificationMetricName } from './notificationMetricsService';

const METRIC_PREFIX = 'metrics:notifications:';

export async function getPushDeliveryStatsForUser(
  userId: string,
  days = 7
): Promise<{ queued: number; delivered: number; failed: number }> {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const [queued, delivered, failed] = await Promise.all([
    PushDeliveryRecord.countDocuments({ userId, status: 'queued', createdAt: { $gte: since } }),
    PushDeliveryRecord.countDocuments({ userId, status: 'delivered', createdAt: { $gte: since } }),
    PushDeliveryRecord.countDocuments({ userId, status: 'failed', createdAt: { $gte: since } }),
  ]);
  return { queued, delivered, failed };
}

export async function getAggregatedMetricCount(
  metric: NotificationMetricName,
  day?: string
): Promise<number> {
  if (!redisEnabled) return 0;
  const d = day ?? new Date().toISOString().slice(0, 10);
  const key = `${METRIC_PREFIX}${metric}:${d}`;
  const raw = await redisConnection.get(key);
  return parseInt(String(raw ?? '0'), 10) || 0;
}

export function trackNotificationOpen(userId: string, notificationId: string): void {
  recordNotificationMetric('push.delivery.success', {
    userId,
    notificationId,
    event: 'opened',
  });
}
