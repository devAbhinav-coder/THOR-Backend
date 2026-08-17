import { createOutboxPoller } from "./createOutboxPoller";
import { processPendingGiftingOutboxBatch } from "../services/gifting/giftingNotificationService";

const poller = createOutboxPoller({
  name: "gifting-outbox",
  enabledEnv: "GIFTING_OUTBOX_POLL_ENABLED",
  intervalEnv: "GIFTING_OUTBOX_POLL_MS",
  defaultIntervalMs: 15_000,
  disabledLogMessage:
    "Gifting outbox poller disabled (GIFTING_OUTBOX_POLL_ENABLED=false)",
  dispatchedLogMsg: "gifting_outbox_poller_dispatched",
  processBatch: processPendingGiftingOutboxBatch,
});

export const startGiftingOutboxPoller = poller.start;
export const stopGiftingOutboxPoller = poller.stop;
