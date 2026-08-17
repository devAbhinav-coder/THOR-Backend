import logger from "../types/utils/logger";
import { enqueueMaintenanceJob } from "../queues/maintenanceQueue";
import { startScheduledJob } from "./scheduledRunner";

const INITIAL_DELAY_MS = Number(process.env.EMBEDDING_BACKFILL_DELAY_MS || 8000);

let stopJob: (() => void) | null = null;
let oneShotTimer: ReturnType<typeof setTimeout> | null = null;

async function runEmbeddingBackfill(): Promise<void> {
  await enqueueMaintenanceJob("embedding-backfill");
}

export function startEmbeddingBackfillJob(): void {
  if (stopJob || oneShotTimer) return;
  if (process.env.EMBEDDING_BACKFILL_ENABLED === "false") {
    logger.info(
      "Embedding backfill disabled (EMBEDDING_BACKFILL_ENABLED=false)",
    );
    return;
  }

  const cronExpr = process.env.EMBEDDING_BACKFILL_CRON?.trim();
  if (cronExpr) {
    stopJob = startScheduledJob({
      name: "embedding-backfill",
      cronExpression: cronExpr,
      initialDelayMs: INITIAL_DELAY_MS,
      onTick: runEmbeddingBackfill,
      onError: (err: unknown) => {
        const message =
          err instanceof Error ? err.message : "Embedding backfill failed";
        logger.warn({ msg: "embedding_backfill_error", error: message });
      },
    });
    logger.info(`Embedding backfill cron job started (${cronExpr})`);
    return;
  }

  oneShotTimer = setTimeout(() => {
    oneShotTimer = null;
    void runEmbeddingBackfill().catch((err: unknown) => {
      const message =
        err instanceof Error ? err.message : "Embedding backfill failed";
      logger.warn({ msg: "embedding_backfill_error", error: message });
    });
  }, INITIAL_DELAY_MS);
  oneShotTimer.unref?.();
  logger.info(
    `Embedding backfill one-shot scheduled (${INITIAL_DELAY_MS}ms delay)`,
  );
}

export function stopEmbeddingBackfillJob(): void {
  if (oneShotTimer) {
    clearTimeout(oneShotTimer);
    oneShotTimer = null;
  }
  if (stopJob) {
    stopJob();
    stopJob = null;
  }
}
