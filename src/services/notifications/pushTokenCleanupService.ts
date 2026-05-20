import { PushSubscriptionModel } from '../../models/PushSubscription';
import ExpoPushToken from '../../models/ExpoPushToken';
import logger from '../../utils/logger';
import { recordNotificationMetric } from './notificationMetricsService';

const INACTIVE_DAYS = Number(process.env.PUSH_TOKEN_INACTIVE_DAYS || 90);
const STALE_MS = INACTIVE_DAYS * 24 * 60 * 60 * 1000;

export async function cleanupInactivePushTokens(): Promise<{
  webDeactivated: number;
  expoDeactivated: number;
}> {
  const cutoff = new Date(Date.now() - STALE_MS);

  const [webResult, expoResult] = await Promise.all([
    PushSubscriptionModel.updateMany(
      {
        isActive: true,
        lastUsedAt: { $lt: cutoff },
      },
      { isActive: false }
    ).maxTimeMS(15_000),
    ExpoPushToken.updateMany(
      {
        isActive: true,
        lastUsedAt: { $lt: cutoff },
      },
      { isActive: false }
    ).maxTimeMS(15_000),
  ]);

  const webDeactivated = webResult.modifiedCount ?? 0;
  const expoDeactivated = expoResult.modifiedCount ?? 0;

  if (webDeactivated > 0 || expoDeactivated > 0) {
    logger.info({
      msg: 'push_token_cleanup',
      webDeactivated,
      expoDeactivated,
      cutoff,
    });
    recordNotificationMetric('push.invalid_token', { phase: 'inactive_cleanup', webDeactivated });
  }

  return { webDeactivated, expoDeactivated };
}
