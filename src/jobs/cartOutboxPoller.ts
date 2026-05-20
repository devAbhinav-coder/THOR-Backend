import logger from '../utils/logger';
import { processPendingCartOutboxBatch } from '../services/cart/cartOutboxService';

const DEFAULT_INTERVAL_MS = Number(process.env.CART_OUTBOX_POLL_MS || 15_000);

let timer: ReturnType<typeof setInterval> | null = null;

export function startCartOutboxPoller(): void {
  if (timer) return;
  if (process.env.CART_OUTBOX_POLL_ENABLED === 'false') {
    logger.info('Cart outbox poller disabled (CART_OUTBOX_POLL_ENABLED=false)');
    return;
  }

  const tick = async () => {
    try {
      const n = await processPendingCartOutboxBatch();
      if (n > 0) {
        logger.info({ msg: 'cart_outbox_poller_dispatched', count: n });
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'cart outbox poll failed';
      logger.error({ msg: 'cart_outbox_poller_error', error: message });
    }
  };

  void tick();
  timer = setInterval(() => void tick(), DEFAULT_INTERVAL_MS);
  logger.info(`Cart outbox poller started (interval ${DEFAULT_INTERVAL_MS}ms)`);
}

export function stopCartOutboxPoller(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
