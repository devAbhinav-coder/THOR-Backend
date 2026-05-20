import logger from '../utils/logger';
import { runInventoryReconciliation } from '../services/inventory/inventoryReconciliationService';

const DEFAULT_INTERVAL_MS = Number(process.env.INVENTORY_RECONCILE_POLL_MS || 60 * 60 * 1000);

let timer: ReturnType<typeof setInterval> | null = null;

export function startInventoryReconciliationJob(): void {
  if (timer) return;
  if (process.env.INVENTORY_RECONCILE_ENABLED === 'false') {
    logger.info('Inventory reconciliation job disabled (INVENTORY_RECONCILE_ENABLED=false)');
    return;
  }

  const tick = async () => {
    try {
      const result = await runInventoryReconciliation();
      if (result.totalStockFixed > 0) {
        logger.warn({ msg: 'inventory_reconciliation_completed', ...result });
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'reconciliation failed';
      logger.error({ msg: 'inventory_reconciliation_error', error: message });
    }
  };

  void tick();
  timer = setInterval(() => void tick(), DEFAULT_INTERVAL_MS);
  logger.info(`Inventory reconciliation job started (interval ${DEFAULT_INTERVAL_MS}ms)`);
}

export function stopInventoryReconciliationJob(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
