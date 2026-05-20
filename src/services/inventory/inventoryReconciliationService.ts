import Product from '../../models/Product';
import StockLedger from '../../models/StockLedger';
import logger from '../../utils/logger';
import { recordInventoryMetric } from './inventoryMetricsService';
import { syncProductTotalStock } from './stockBulkService';

const RECONCILE_BATCH = Number(process.env.INVENTORY_RECONCILE_BATCH || 50);

export interface ReconciliationResult {
  totalStockFixed: number;
  ledgerOrphans: number;
  scanned: number;
}

/**
 * Reconcile denormalized totalStock with sum(variants.stock) for active products.
 * Optionally sample ledger rows missing a matching product (read-only audit).
 */
export async function runInventoryReconciliation(): Promise<ReconciliationResult> {
  const products = await Product.find({ isActive: true })
    .select('_id variants.stock totalStock')
    .limit(RECONCILE_BATCH)
    .lean();

  let totalStockFixed = 0;
  for (const p of products) {
    const variants = p.variants as { stock: number }[];
    const computed = variants.reduce((acc, v) => acc + (v.stock ?? 0), 0);
    if (computed !== p.totalStock) {
      await syncProductTotalStock(String(p._id));
      totalStockFixed += 1;
      recordInventoryMetric('inventory.reconciliation.drift', {
        productId: String(p._id),
        stored: p.totalStock,
        computed,
      });
      logger.warn({
        msg: 'inventory_total_stock_drift_fixed',
        productId: String(p._id),
        stored: p.totalStock,
        computed,
      });
    }
  }

  // Lightweight orphan check: ledger entries whose product no longer exists
  const sampleLedgers = await StockLedger.find()
    .sort('-createdAt')
    .limit(20)
    .select('product')
    .lean();
  let orphanCount = 0;
  for (const row of sampleLedgers) {
    const exists = await Product.exists({ _id: row.product });
    if (!exists) orphanCount += 1;
  }

  return {
    totalStockFixed,
    ledgerOrphans: orphanCount,
    scanned: products.length,
  };
}
