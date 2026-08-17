import { createOutboxPoller } from "./createOutboxPoller";
import { processPendingCouponBroadcastBatch } from "../services/coupon/couponBroadcastOutboxService";

const poller = createOutboxPoller({
  name: "coupon-outbox",
  enabledEnv: "COUPON_OUTBOX_POLL_ENABLED",
  intervalEnv: "COUPON_OUTBOX_POLL_MS",
  defaultIntervalMs: 20_000,
  disabledLogMessage:
    "Coupon outbox poller disabled (COUPON_OUTBOX_POLL_ENABLED=false)",
  dispatchedLogMsg: "coupon_outbox_poller_dispatched",
  processBatch: processPendingCouponBroadcastBatch,
});

export const startCouponOutboxPoller = poller.start;
export const stopCouponOutboxPoller = poller.stop;
