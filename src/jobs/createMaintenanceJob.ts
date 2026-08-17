import { runWithJobHealth } from "./jobHealthService";
import logger from "../types/utils/logger";
import { withPollerLock } from "./pollerLock";
import { startScheduledJob } from "./scheduledRunner";
import {
  enqueueMaintenanceJob,
  shouldUseMaintenanceQueue,
} from "../queues/maintenanceQueue";

export type MaintenanceJobConfig = {
  name: string;
  enabledEnv: string;
  /** When true, job runs only if `{enabledEnv}=true` (opt-in). Default opt-out. */
  requireExplicitEnable?: boolean;
  intervalMs?: number;
  cronExpression?: string;
  initialDelayMs?: number;
  disabledLogMessage?: string;
  /** When true (default), heavy work runs via BullMQ worker instead of inline tick. */
  useQueue?: boolean;
  run: () => Promise<void | number | Record<string, unknown>>;
};

export function createMaintenanceJob(config: MaintenanceJobConfig): {
  start: () => void;
  stop: () => void;
} {
  let stopJob: (() => void) | null = null;

  return {
    start() {
      if (stopJob) return;

      const envVal = process.env[config.enabledEnv];
      if (config.requireExplicitEnable) {
        if (envVal !== "true") {
          logger.info(
            config.disabledLogMessage ||
              `${config.name} job disabled (${config.enabledEnv} must be true)`,
          );
          return;
        }
      } else if (envVal === "false") {
        logger.info(
          config.disabledLogMessage ||
            `${config.name} job disabled (${config.enabledEnv}=false)`,
        );
        return;
      }

      const intervalMs = config.intervalMs;
      const lockTtlMs =
        config.cronExpression ?
          55 * 60 * 1000
        : Math.max(Math.floor((intervalMs ?? 60_000) * 0.9), 10_000);

      stopJob = startScheduledJob({
        name: config.name,
        cronExpression: config.cronExpression,
        intervalMs: config.cronExpression ? undefined : intervalMs,
        initialDelayMs: config.initialDelayMs,
        onTick: async () => {
          await withPollerLock(config.name, lockTtlMs, async () => {
            const useQueue =
              config.useQueue !== false && shouldUseMaintenanceQueue();
            if (useQueue) {
              await enqueueMaintenanceJob(config.name);
              return;
            }
            await runWithJobHealth(config.name, async () => {
              const result = await config.run();
              if (typeof result === "number" && result > 0) {
                logger.info({ msg: `${config.name}_completed`, count: result });
              } else if (result && typeof result === "object") {
                logger.info({ msg: `${config.name}_completed`, ...result });
              }
              return typeof result === "number" ? result : 0;
            });
          });
        },
        onError: (err: unknown) => {
          const message = err instanceof Error ? err.message : "job failed";
          logger.error({ msg: `${config.name}_error`, error: message });
        },
      });

      logger.info({
        msg: `${config.name}_started`,
        schedule: config.cronExpression ? "cron" : "interval",
        cronExpression: config.cronExpression,
        intervalMs: config.cronExpression ? undefined : intervalMs,
      });
    },

    stop() {
      if (stopJob) {
        stopJob();
        stopJob = null;
      }
    },
  };
}
