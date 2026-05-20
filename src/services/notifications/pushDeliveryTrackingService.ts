import PushDeliveryRecord from '../../models/PushDeliveryRecord';
import { buildPushDedupeKey } from './pushDedupe';
import { recordNotificationMetric } from './notificationMetricsService';
import type { PushJobData } from '../../queues/pushQueue';

export async function markPushDelivered(
  userId: string,
  notificationId?: string,
  errorMessage?: string
): Promise<void> {
  const filter: Record<string, unknown> = { userId };
  if (notificationId) {
    filter.dedupeKey = buildPushDedupeKey({
      userId,
      title: '',
      body: '',
      notificationId,
    });
  }

  await PushDeliveryRecord.updateMany(filter, {
    $set: {
      status: errorMessage ? 'failed' : 'delivered',
      deliveredAt: new Date(),
      errorMessage: errorMessage?.slice(0, 500),
    },
  });

  if (errorMessage) {
    recordNotificationMetric('push.delivery.failure', { userId });
  } else {
    recordNotificationMetric('push.delivery.success', { userId });
  }
}

export async function trackInvalidPushToken(tokenType: 'web' | 'expo'): Promise<void> {
  recordNotificationMetric('push.invalid_token', { tokenType });
}

export type { PushJobData };
