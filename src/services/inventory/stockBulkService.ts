import { ClientSession, Types } from "mongoose";
import Product from "../../models/Product";
import AppError from "../../types/utils/AppError";
import { recordInventoryMetric } from "./inventoryMetricsService";

export interface StockIncrementOp {
  productId: string;
  sku: string;
  quantity: number;
  unitCost?: number;
  updateCostPrice?: boolean;
}

export interface BulkWriteValidation {
  expectedOps: number;
  matchedCount: number;
  modifiedCount: number;
  failedSkus: string[];
}

function buildIncrementOp(
  op: StockIncrementOp,
): Parameters<typeof Product.bulkWrite>[0][number] {
  return {
    updateOne: {
      filter: { _id: op.productId, "variants.sku": op.sku },
      update: {
        $inc: { "variants.$[v].stock": op.quantity, totalStock: op.quantity },
        ...(op.updateCostPrice !== false && op.unitCost !== undefined ?
          { $set: { "variants.$[v].costPrice": op.unitCost } }
        : {}),
      },
      arrayFilters: [{ "v.sku": op.sku }],
    },
  };
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

  const bulkOps = ops.map(buildIncrementOp);
  const result = await Product.bulkWrite(bulkOps, {
    ...(session ? { session } : {}),
    ordered: true,
  });

  const expectedOps = ops.length;
  const matchedCount = result.matchedCount ?? 0;
  const modifiedCount = result.modifiedCount ?? 0;

  if (matchedCount < expectedOps) {
    const failedSkus: string[] = [];
    for (const op of ops) {
      let existsQuery = Product.exists({
        _id: new Types.ObjectId(op.productId),
        "variants.sku": op.sku,
      });
      if (session) existsQuery = existsQuery.session(session);
      const exists = await existsQuery;
      if (!exists) failedSkus.push(op.sku);
    }
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
