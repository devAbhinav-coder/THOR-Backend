import logger from '../utils/logger';
import { processPendingCouponBroadcastBatch } from '../services/coupon/couponBroadcastOutboxService';

const DEFAULT_INTERVAL_MS = Number(process.env.COUPON_OUTBOX_POLL_MS || 20_000);

let timer: ReturnType<typeof setInterval> | null = null;

export function startCouponOutboxPoller(): void {
  if (timer) return;
  if (process.env.COUPON_OUTBOX_POLL_ENABLED === 'false') {
    logger.info('Coupon outbox poller disabled (COUPON_OUTBOX_POLL_ENABLED=false)');
    return;
  }

  const tick = async () => {
    try {
      const n = await processPendingCouponBroadcastBatch();
      if (n > 0) {
        logger.info({ msg: 'coupon_outbox_poller_dispatched', count: n });
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'coupon outbox poll failed';
      logger.error({ msg: 'coupon_outbox_poller_error', error: message });
    }
  };

  void tick();
  timer = setInterval(() => void tick(), DEFAULT_INTERVAL_MS);
  logger.info(`Coupon outbox poller started (interval ${DEFAULT_INTERVAL_MS}ms)`);
}

export function stopCouponOutboxPoller(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
