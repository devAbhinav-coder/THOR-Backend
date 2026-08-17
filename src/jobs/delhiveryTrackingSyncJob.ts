import logger from "../types/utils/logger";
import { delhiveryIsConfigured } from "../config/delhivery";
import { enqueueMaintenanceJob } from "../queues/maintenanceQueue";
import { withPollerLock } from "./pollerLock";
import { startScheduledJob } from "./scheduledRunner";

const DEFAULT_INTERVAL_MS = Number(
  process.env.DELHIVERY_TRACK_SYNC_MS || 20 * 60 * 1000,
);
const INITIAL_DELAY_MS = Number(
  process.env.DELHIVERY_TRACK_SYNC_INITIAL_MS || 20_000,
);

let stopJob: (() => void) | null = null;

export function startDelhiveryTrackingSyncJob(): void {
  if (stopJob) return;
  if (process.env.DELHIVERY_TRACK_SYNC_ENABLED === "false") {
    logger.info(
      "Delhivery tracking sync disabled (DELHIVERY_TRACK_SYNC_ENABLED=false)",
    );
    return;
  }
  if (!delhiveryIsConfigured() || DEFAULT_INTERVAL_MS <= 0) {
    logger.info("Delhivery tracking sync skipped (not configured or interval 0)");
    return;
  }

  const lockTtlMs = Math.max(Math.floor(DEFAULT_INTERVAL_MS * 0.9), 60_000);

  stopJob = startScheduledJob({
    name: "delhivery-tracking-sync",
    intervalMs: DEFAULT_INTERVAL_MS,
    initialDelayMs: INITIAL_DELAY_MS,
    onTick: async () => {
      await withPollerLock("delhivery-tracking-sync", lockTtlMs, async () => {
        await enqueueMaintenanceJob("delhivery-tracking-sync");
      });
    },
    onError: (err: unknown) => {
      const message =
        err instanceof Error ? err.message : "Delhivery sync failed";
      logger.error({ msg: "delhivery_tracking_sync_error", error: message });
    },
  });

  logger.info(
    `Delhivery tracking sync job started (interval ${DEFAULT_INTERVAL_MS}ms)`,
  );
}

export function stopDelhiveryTrackingSyncJob(): void {
  if (stopJob) {
    stopJob();
    stopJob = null;
  }
}
