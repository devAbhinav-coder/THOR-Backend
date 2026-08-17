import logger from "../types/utils/logger";
import { runNotificationRetentionBatch } from "../services/notifications/notificationRetentionService";
import { cleanupInactivePushTokens } from "../services/notifications/pushTokenCleanupService";
import { withPollerLock } from "./pollerLock";
import { startScheduledJob } from "./scheduledRunner";

const DEFAULT_INTERVAL_MS = Number(
  process.env.NOTIFICATION_MAINTENANCE_MS || 6 * 60 * 60 * 1000,
);
const CRON_EXPRESSION = process.env.NOTIFICATION_MAINTENANCE_CRON?.trim();

let stopJob: (() => void) | null = null;

export function startNotificationMaintenanceJob(): void {
  if (stopJob) return;
  if (process.env.NOTIFICATION_MAINTENANCE_ENABLED === "false") {
    logger.info("Notification maintenance job disabled");
    return;
  }

  const lockTtlMs = CRON_EXPRESSION ?
      55 * 60 * 1000
    : Math.max(Math.floor(DEFAULT_INTERVAL_MS * 0.9), 60_000);

  stopJob = startScheduledJob({
    name: "notification-maintenance",
    cronExpression: CRON_EXPRESSION || undefined,
    intervalMs: CRON_EXPRESSION ? undefined : DEFAULT_INTERVAL_MS,
    onTick: async () => {
      await withPollerLock("notification-maintenance", lockTtlMs, async () => {
        const retention = await runNotificationRetentionBatch();
        const tokens = await cleanupInactivePushTokens();
        logger.info({
          msg: "notification_maintenance_completed",
          retention,
          tokens,
        });
      });
    },
    onError: (err: unknown) => {
      const message = err instanceof Error ? err.message : "maintenance failed";
      logger.error({ msg: "notification_maintenance_error", error: message });
    },
  });

  logger.info({
    msg: "notification_maintenance_job_started",
    schedule: CRON_EXPRESSION ? "cron" : "interval",
    cronExpression: CRON_EXPRESSION,
    intervalMs: CRON_EXPRESSION ? undefined : DEFAULT_INTERVAL_MS,
  });
}

export function stopNotificationMaintenanceJob(): void {
  if (stopJob) {
    stopJob();
    stopJob = null;
  }
}
