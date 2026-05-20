import { ClientSession, Types } from 'mongoose';
import StockLedger, { StockChangeReason } from '../../models/StockLedger';
import Product from '../../models/Product';
import { INVENTORY_QUERY_MAX_MS } from '../../constants/inventoryQuery';

export interface LedgerWriteInput {
  product: string;
  sku: string;
  productName: string;
  variantLabel?: string;
  delta: number;
  stockAfter: number;
  reason: StockChangeReason;
  referenceId?: string;
  referenceType?: 'order' | 'purchase_invoice' | 'manual';
  actor?: Types.ObjectId | string;
  note?: string;
}

export async function insertLedgerEntries(
  entries: LedgerWriteInput[],
  session?: ClientSession
): Promise<void> {
  if (entries.length === 0) return;
  await StockLedger.insertMany(entries, {
    ordered: false,
    ...(session ? { session } : {}),
  });
}

export async function listStockLedger(params: {
  page: number;
  limit: number;
  productId?: string;
  sku?: string;
  reason?: string;
  from?: string;
  to?: string;
}): Promise<{ entries: unknown[]; total: number }> {
  const skip = (params.page - 1) * params.limit;
  const filter: Record<string, unknown> = {};
  if (params.productId && Types.ObjectId.isValid(params.productId)) {
    filter.product = params.productId;
  }
  if (params.sku) filter.sku = params.sku;
  if (params.reason) filter.reason = params.reason;
  if (params.from || params.to) {
    const createdAt: Record<string, Date> = {};
    if (params.from) createdAt.$gte = new Date(params.from);
    if (params.to) createdAt.$lte = new Date(params.to);
    filter.createdAt = createdAt;
  }

  const [entries, total] = await Promise.all([
    StockLedger.find(filter)
      .sort('-createdAt')
      .skip(skip)
      .limit(params.limit)
      .populate('actor', 'name email')
      .lean()
      .maxTimeMS(INVENTORY_QUERY_MAX_MS),
    StockLedger.countDocuments(filter).maxTimeMS(INVENTORY_QUERY_MAX_MS),
  ]);

  return { entries, total };
}

export async function buildLedgerFromProduct(
  productId: string,
  sku: string,
  delta: number,
  opts: Omit<LedgerWriteInput, 'product' | 'sku' | 'delta' | 'stockAfter' | 'productName' | 'variantLabel'> & {
    productName?: string;
    variantLabel?: string;
    stockAfter?: number;
  },
  session?: ClientSession
): Promise<LedgerWriteInput | null> {
  const product = await Product.findById(productId)
    .select('name variants')
    .session(session ?? null)
    .lean();
  if (!product) return null;

  const variant = (product.variants as { sku: string; stock: number; size?: string; color?: string }[]).find(
    (v) => v.sku === sku
  );
  const stockAfter = opts.stockAfter ?? variant?.stock ?? 0;
  const parts: string[] = [];
  if (variant?.size) parts.push(variant.size);
  if (variant?.color) parts.push(variant.color);
  const variantLabel = opts.variantLabel ?? (parts.length > 0 ? parts.join(' / ') : sku);

  return {
    product: productId,
    sku,
    productName: opts.productName ?? product.name,
    variantLabel,
    delta,
    stockAfter,
    reason: opts.reason,
    referenceId: opts.referenceId,
    referenceType: opts.referenceType,
    actor: opts.actor,
    note: opts.note,
  };
}
