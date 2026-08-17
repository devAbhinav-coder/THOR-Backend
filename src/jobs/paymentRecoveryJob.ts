import logger from "../types/utils/logger";
import { enqueueMaintenanceJob } from "../queues/maintenanceQueue";
import { withPollerLock } from "./pollerLock";
import { startScheduledJob } from "./scheduledRunner";

const DEFAULT_INTERVAL_MS = Number(
  process.env.PAYMENT_RECOVERY_MS || 30 * 60 * 1000,
);
const INITIAL_DELAY_MS = Number(
  process.env.PAYMENT_RECOVERY_INITIAL_MS || 60_000,
);

let stopJob: (() => void) | null = null;

export function startPaymentRecoveryJob(): void {
  if (stopJob) return;
  if (process.env.PAYMENT_RECOVERY_ENABLED === "false") {
    logger.info(
      "Payment recovery job disabled (PAYMENT_RECOVERY_ENABLED=false)",
    );
    return;
  }
  if (DEFAULT_INTERVAL_MS <= 0 || !process.env.RAZORPAY_KEY_ID?.trim()) {
    logger.info("Payment recovery job skipped (disabled or Razorpay not configured)");
    return;
  }

  const lockTtlMs = Math.max(Math.floor(DEFAULT_INTERVAL_MS * 0.9), 60_000);

  stopJob = startScheduledJob({
    name: "payment-recovery",
    intervalMs: DEFAULT_INTERVAL_MS,
    initialDelayMs: INITIAL_DELAY_MS,
    onTick: async () => {
      await withPollerLock("payment-recovery", lockTtlMs, async () => {
        await enqueueMaintenanceJob("payment-recovery");
      });
    },
    onError: (err: unknown) => {
      const message =
        err instanceof Error ? err.message : "Payment recovery failed";
      logger.error({ msg: "payment_recovery_error", error: message });
    },
  });

  logger.info(
    `Payment recovery job started (interval ${DEFAULT_INTERVAL_MS}ms)`,
  );
}

export function stopPaymentRecoveryJob(): void {
  if (stopJob) {
    stopJob();
    stopJob = null;
  }
}
