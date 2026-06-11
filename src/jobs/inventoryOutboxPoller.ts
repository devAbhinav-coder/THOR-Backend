import logger from "../types/utils/logger";
import { processPendingInventoryOutboxBatch } from "../services/inventory/inventoryOutboxService";

const DEFAULT_INTERVAL_MS = Number(
  process.env.INVENTORY_OUTBOX_POLL_MS || 15_000,
);

let timer: ReturnType<typeof setInterval> | null = null;

export function startInventoryOutboxPoller(): void {
  if (timer) return;
  if (process.env.INVENTORY_OUTBOX_POLL_ENABLED === "false") {
    logger.info(
      "Inventory outbox poller disabled (INVENTORY_OUTBOX_POLL_ENABLED=false)",
    );
    return;
  }

  const tick = async () => {
    try {
      const n = await processPendingInventoryOutboxBatch();
      if (n > 0) {
        logger.info({ msg: "inventory_outbox_poller_dispatched", count: n });
      }
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : "inventory outbox poll failed";
      logger.error({ msg: "inventory_outbox_poller_error", error: message });
    }
  };

  void tick();
  timer = setInterval(() => void tick(), DEFAULT_INTERVAL_MS);
  logger.info(
    `Inventory outbox poller started (interval ${DEFAULT_INTERVAL_MS}ms)`,
  );
}

export function stopInventoryOutboxPoller(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
