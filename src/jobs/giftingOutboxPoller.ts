import logger from '../utils/logger';
import { processPendingGiftingOutboxBatch } from '../services/gifting/giftingNotificationService';

const DEFAULT_INTERVAL_MS = Number(process.env.GIFTING_OUTBOX_POLL_MS || 15_000);

let timer: ReturnType<typeof setInterval> | null = null;

export function startGiftingOutboxPoller(): void {
  if (timer) return;
  if (process.env.GIFTING_OUTBOX_POLL_ENABLED === 'false') {
    logger.info('Gifting outbox poller disabled (GIFTING_OUTBOX_POLL_ENABLED=false)');
    return;
  }

  const tick = async () => {
    try {
      const n = await processPendingGiftingOutboxBatch();
      if (n > 0) {
        logger.info({ msg: 'gifting_outbox_poller_dispatched', count: n });
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'gifting outbox poll failed';
      logger.error({ msg: 'gifting_outbox_poller_error', error: message });
    }
  };

  void tick();
  timer = setInterval(() => void tick(), DEFAULT_INTERVAL_MS);
  logger.info(`Gifting outbox poller started (interval ${DEFAULT_INTERVAL_MS}ms)`);
}

export function stopGiftingOutboxPoller(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
