import logger from "../types/utils/logger";
import { processPendingOutboxBatch } from "../services/orderEventOutboxService";

const DEFAULT_INTERVAL_MS = Number(process.env.ORDER_OUTBOX_POLL_MS || 15_000);

let timer: ReturnType<typeof setInterval> | null = null;

export function startOrderOutboxPoller(): void {
  if (timer) return;
  if (process.env.ORDER_OUTBOX_POLL_ENABLED === "false") {
    logger.info(
      "Order outbox poller disabled (ORDER_OUTBOX_POLL_ENABLED=false)",
    );
    return;
  }

  const tick = async () => {
    try {
      const n = await processPendingOutboxBatch();
      if (n > 0) {
        logger.info({ msg: "order_outbox_poller_dispatched", count: n });
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "outbox poll failed";
      logger.error({ msg: "order_outbox_poller_error", error: message });
    }
  };

  void tick();
  timer = setInterval(() => void tick(), DEFAULT_INTERVAL_MS);
  logger.info(
    `Order outbox poller started (interval ${DEFAULT_INTERVAL_MS}ms)`,
  );
}

export function stopOrderOutboxPoller(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
