import { createOutboxPoller } from "./createOutboxPoller";
import { processPendingPushOutboxBatch } from "../services/notifications/pushOutboxService";

const poller = createOutboxPoller({
  name: "push-outbox",
  enabledEnv: "PUSH_OUTBOX_POLL_ENABLED",
  intervalEnv: "PUSH_OUTBOX_POLL_MS",
  defaultIntervalMs: 15_000,
  disabledLogMessage:
    "Push outbox poller disabled (PUSH_OUTBOX_POLL_ENABLED=false)",
  dispatchedLogMsg: "push_outbox_poller_dispatched",
  processBatch: processPendingPushOutboxBatch,
});

export const startPushOutboxPoller = poller.start;
export const stopPushOutboxPoller = poller.stop;
