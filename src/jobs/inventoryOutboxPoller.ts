import { createOutboxPoller } from "./createOutboxPoller";
import { processPendingInventoryOutboxBatch } from "../services/inventory/inventoryOutboxService";

const poller = createOutboxPoller({
  name: "inventory-outbox",
  enabledEnv: "INVENTORY_OUTBOX_POLL_ENABLED",
  intervalEnv: "INVENTORY_OUTBOX_POLL_MS",
  defaultIntervalMs: 15_000,
  disabledLogMessage:
    "Inventory outbox poller disabled (INVENTORY_OUTBOX_POLL_ENABLED=false)",
  dispatchedLogMsg: "inventory_outbox_poller_dispatched",
  processBatch: processPendingInventoryOutboxBatch,
});

export const startInventoryOutboxPoller = poller.start;
export const stopInventoryOutboxPoller = poller.stop;
