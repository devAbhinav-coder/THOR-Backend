import logger from '../utils/logger';
import { runNotificationRetentionBatch } from '../services/notifications/notificationRetentionService';
import { cleanupInactivePushTokens } from '../services/notifications/pushTokenCleanupService';

const DEFAULT_INTERVAL_MS = Number(process.env.NOTIFICATION_MAINTENANCE_MS || 6 * 60 * 60 * 1000);

let timer: ReturnType<typeof setInterval> | null = null;

export function startNotificationMaintenanceJob(): void {
  if (timer) return;
  if (process.env.NOTIFICATION_MAINTENANCE_ENABLED === 'false') {
    logger.info('Notification maintenance job disabled');
    return;
  }

  const tick = async () => {
    try {
      const retention = await runNotificationRetentionBatch();
      const tokens = await cleanupInactivePushTokens();
      logger.info({
        msg: 'notification_maintenance_completed',
        retention,
        tokens,
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'maintenance failed';
      logger.error({ msg: 'notification_maintenance_error', error: message });
    }
  };

  void tick();
  timer = setInterval(() => void tick(), DEFAULT_INTERVAL_MS);
  logger.info(`Notification maintenance job started (interval ${DEFAULT_INTERVAL_MS}ms)`);
}

export function stopNotificationMaintenanceJob(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
