import { ClientSession, Types } from "mongoose";
import Product from "../../models/Product";
import AppError from "../../types/utils/AppError";
import { recordInventoryMetric } from "./inventoryMetricsService";
import { resolveCostAfterPurchase } from "./costMethodHelpers";

export interface StockIncrementOp {
  productId: string;
  sku: string;
  quantity: number;
  unitCost?: number;
  updateCostPrice?: boolean;
  /** weighted = WAC (default), replace = latest invoice cost only */
  costMethod?: "weighted" | "replace";
}

export interface BulkWriteValidation {
  expectedOps: number;
  matchedCount: number;
  modifiedCount: number;
  failedSkus: string[];
}

/**
 * Apply stock increment with weighted-average cost (WAC) by default.
 */
async function applySingleIncrement(
  op: StockIncrementOp,
  session?: ClientSession,
): Promise<boolean> {
  const product = await Product.findOne({
    _id: op.productId,
    "variants.sku": op.sku,
  }).session(session ?? null);

  if (!product) return false;

  const variant = product.variants.find((v) => v.sku === op.sku);
  if (!variant) return false;

  const oldStock = variant.stock ?? 0;
  variant.stock = oldStock + op.quantity;

  if (op.updateCostPrice !== false && op.unitCost !== undefined) {
    variant.costPrice = resolveCostAfterPurchase(
      oldStock,
      variant.costPrice ?? 0,
      op.quantity,
      op.unitCost,
      op.costMethod ?? "weighted",
    );
  }

  product.totalStock = product.variants.reduce(
    (acc, v) => acc + (v.stock ?? 0),
    0,
  );
  await product.save({ session: session ?? undefined });
  return true;
}

/**
 * Execute batched stock increments and validate every SKU matched a product variant.
 */
export async function executeStockIncrements(
  ops: StockIncrementOp[],
  session?: ClientSession,
): Promise<BulkWriteValidation> {
  if (ops.length === 0) {
    return {
      expectedOps: 0,
      matchedCount: 0,
      modifiedCount: 0,
      failedSkus: [],
    };
  }

  let matchedCount = 0;
  const failedSkus: string[] = [];

  for (const op of ops) {
    const ok = await applySingleIncrement(op, session);
    if (ok) matchedCount += 1;
    else failedSkus.push(op.sku);
  }

  const expectedOps = ops.length;
  const modifiedCount = matchedCount;

  if (matchedCount < expectedOps) {
    recordInventoryMetric("inventory.bulk_write.mismatch", {
      expectedOps,
      matchedCount,
      modifiedCount,
      failedCount: failedSkus.length,
    });
    throw new AppError(
      `Stock update failed for SKU(s): ${failedSkus.join(", ") || "unknown"}. Invoice rolled back.`,
      409,
    );
  }

  return { expectedOps, matchedCount, modifiedCount, failedSkus: [] };
}

/** Recompute denormalized totalStock from variant stocks for one product. */
export async function syncProductTotalStock(
  productId: string,
  session?: ClientSession,
): Promise<number | null> {
  const product = await Product.findById(productId)
    .select("variants.stock")
    .session(session ?? null)
    .lean();
  if (!product) return null;
  const variants = product.variants as { stock: number }[];
  const total = variants.reduce((acc, v) => acc + (v.stock ?? 0), 0);
  await Product.updateOne(
    { _id: productId },
    { $set: { totalStock: total } },
    { ...(session ? { session } : {}) },
  );
  return total;
}

/** Recompute product soldCount as sum of variant soldCounts. */
export async function syncProductSoldCount(
  productId: string,
  session?: ClientSession,
): Promise<number | null> {
  const product = await Product.findById(productId)
    .select("variants.soldCount")
    .session(session ?? null)
    .lean();
  if (!product) return null;
  const total = (product.variants as { soldCount?: number }[]).reduce(
    (acc, v) => acc + (v.soldCount ?? 0),
    0,
  );
  await Product.updateOne(
    { _id: productId },
    { $set: { soldCount: total } },
    { ...(session ? { session } : {}) },
  );
  return total;
}

export async function readVariantStockAfter(
  productId: string,
  sku: string,
  session?: ClientSession,
): Promise<number> {
  const product = await Product.findById(productId)
    .select("variants.sku variants.stock")
    .session(session ?? null)
    .lean();
  if (!product) return 0;
  const variant = (product.variants as { sku: string; stock: number }[]).find(
    (v) => v.sku === sku,
  );
  return variant?.stock ?? 0;
}
