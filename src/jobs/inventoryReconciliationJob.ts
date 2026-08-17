import logger from "../types/utils/logger";
import { runInventoryReconciliation } from "../services/inventory/inventoryReconciliationService";
import { withPollerLock } from "./pollerLock";
import { startScheduledJob } from "./scheduledRunner";

const DEFAULT_INTERVAL_MS = Number(
  process.env.INVENTORY_RECONCILE_POLL_MS || 60 * 60 * 1000,
);
const CRON_EXPRESSION = process.env.INVENTORY_RECONCILE_CRON?.trim();

let stopJob: (() => void) | null = null;

export function startInventoryReconciliationJob(): void {
  if (stopJob) return;
  if (process.env.INVENTORY_RECONCILE_ENABLED === "false") {
    logger.info(
      "Inventory reconciliation job disabled (INVENTORY_RECONCILE_ENABLED=false)",
    );
    return;
  }

  const lockTtlMs = CRON_EXPRESSION ?
      55 * 60 * 1000
    : Math.max(Math.floor(DEFAULT_INTERVAL_MS * 0.9), 60_000);

  stopJob = startScheduledJob({
    name: "inventory-reconciliation",
    cronExpression: CRON_EXPRESSION || undefined,
    intervalMs: CRON_EXPRESSION ? undefined : DEFAULT_INTERVAL_MS,
    onTick: async () => {
      await withPollerLock("inventory-reconciliation", lockTtlMs, async () => {
        const result = await runInventoryReconciliation();
        if (result.totalStockFixed > 0) {
          logger.warn({ msg: "inventory_reconciliation_completed", ...result });
        }
      });
    },
    onError: (err: unknown) => {
      const message =
        err instanceof Error ? err.message : "reconciliation failed";
      logger.error({ msg: "inventory_reconciliation_error", error: message });
    },
  });

  logger.info({
    msg: "inventory_reconciliation_job_started",
    schedule: CRON_EXPRESSION ? "cron" : "interval",
    cronExpression: CRON_EXPRESSION,
    intervalMs: CRON_EXPRESSION ? undefined : DEFAULT_INTERVAL_MS,
  });
}

export function stopInventoryReconciliationJob(): void {
  if (stopJob) {
    stopJob();
    stopJob = null;
  }
}
