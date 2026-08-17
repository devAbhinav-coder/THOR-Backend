import logger from "../types/utils/logger";
import { withPollerLock } from "./pollerLock";
import { startScheduledJob } from "./scheduledRunner";
import { runWithJobHealth } from "./jobHealthService";

export type OutboxPollerConfig = {
  name: string;
  enabledEnv: string;
  intervalEnv: string;
  defaultIntervalMs: number;
  disabledLogMessage: string;
  dispatchedLogMsg: string;
  processBatch: () => Promise<number>;
};

export function createOutboxPoller(config: OutboxPollerConfig): {
  start: () => void;
  stop: () => void;
} {
  let stopJob: (() => void) | null = null;

  return {
    start() {
      if (stopJob) return;
      if (process.env[config.enabledEnv] === "false") {
        logger.info(config.disabledLogMessage);
        return;
      }

      const intervalMs = Number(
        process.env[config.intervalEnv] || config.defaultIntervalMs,
      );
      const lockTtlMs = Math.max(Math.floor(intervalMs * 0.9), 5_000);

      stopJob = startScheduledJob({
        name: config.name,
        intervalMs,
        onTick: async () => {
          await withPollerLock(config.name, lockTtlMs, async () => {
            await runWithJobHealth(config.name, async () => {
              const count = await config.processBatch();
              if (count > 0) {
                logger.info({ msg: config.dispatchedLogMsg, count });
              }
              return count;
            });
          });
        },
        onError: (err: unknown) => {
          const message =
            err instanceof Error ? err.message : "outbox poll failed";
          logger.error({
            msg: `${config.name}_poller_error`,
            error: message,
          });
        },
      });

      logger.info(
        `${config.name} poller started (interval ${intervalMs}ms, distributed lock enabled)`,
      );
    },

    stop() {
      if (stopJob) {
        stopJob();
        stopJob = null;
      }
    },
  };
}
