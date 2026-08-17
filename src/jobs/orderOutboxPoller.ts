import { createOutboxPoller } from "./createOutboxPoller";
import { processPendingOutboxBatch } from "../services/orderEventOutboxService";

const poller = createOutboxPoller({
  name: "order-outbox",
  enabledEnv: "ORDER_OUTBOX_POLL_ENABLED",
  intervalEnv: "ORDER_OUTBOX_POLL_MS",
  defaultIntervalMs: 15_000,
  disabledLogMessage:
    "Order outbox poller disabled (ORDER_OUTBOX_POLL_ENABLED=false)",
  dispatchedLogMsg: "order_outbox_poller_dispatched",
  processBatch: processPendingOutboxBatch,
});

export const startOrderOutboxPoller = poller.start;
export const stopOrderOutboxPoller = poller.stop;
