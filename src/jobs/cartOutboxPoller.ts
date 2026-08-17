import { createOutboxPoller } from "./createOutboxPoller";
import { processPendingCartOutboxBatch } from "../services/cart/cartOutboxService";

const poller = createOutboxPoller({
  name: "cart-outbox",
  enabledEnv: "CART_OUTBOX_POLL_ENABLED",
  intervalEnv: "CART_OUTBOX_POLL_MS",
  defaultIntervalMs: 15_000,
  disabledLogMessage:
    "Cart outbox poller disabled (CART_OUTBOX_POLL_ENABLED=false)",
  dispatchedLogMsg: "cart_outbox_poller_dispatched",
  processBatch: processPendingCartOutboxBatch,
});

export const startCartOutboxPoller = poller.start;
export const stopCartOutboxPoller = poller.stop;
