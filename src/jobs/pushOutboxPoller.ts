import logger from "../types/utils/logger";
import { processPendingPushOutboxBatch } from "../services/notifications/pushOutboxService";

const DEFAULT_INTERVAL_MS = Number(process.env.PUSH_OUTBOX_POLL_MS || 15_000);

let timer: ReturnType<typeof setInterval> | null = null;

export function startPushOutboxPoller(): void {
  if (timer) return;
  if (process.env.PUSH_OUTBOX_POLL_ENABLED === "false") {
    logger.info("Push outbox poller disabled (PUSH_OUTBOX_POLL_ENABLED=false)");
    return;
  }

  const tick = async () => {
    try {
      const n = await processPendingPushOutboxBatch();
      if (n > 0) {
        logger.info({ msg: "push_outbox_poller_dispatched", count: n });
      }
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : "push outbox poll failed";
      logger.error({ msg: "push_outbox_poller_error", error: message });
    }
  };

  void tick();
  timer = setInterval(() => void tick(), DEFAULT_INTERVAL_MS);
  logger.info(`Push outbox poller started (interval ${DEFAULT_INTERVAL_MS}ms)`);
}

export function stopPushOutboxPoller(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
