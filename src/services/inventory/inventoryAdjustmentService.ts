import { Types } from "mongoose";
import Product from "../../models/Product";
import AppError from "../../types/utils/AppError";
import { runInTransaction } from "../../types/utils/mongoTransaction";
import { getRequestContext } from "../../types/utils/requestContext";
import logger from "../../types/utils/logger";
import { writeAdminAudit } from "../adminAuditService";
import { invalidatePdpForProductId } from "../productCacheService";
import { AuthRequest } from "../../types";
import {
  buildLedgerFromProduct,
  insertLedgerEntries,
} from "./stockLedgerService";
import { scheduleInventorySummaryInvalidation } from "./inventoryCacheService";
import { recordInventoryMetric } from "./inventoryMetricsService";
import { syncProductTotalStock } from "./stockBulkService";

export interface StockAdjustmentInput {
  productId: string;
  sku: string;
  delta?: number;
  reason: string;
  note?: string;
  costPrice?: number;
  price?: number;
}

const VALID_REASONS = [
  "purchase",
  "sale_return",
  "damage",
  "manual_correction",
  "opening_stock",
] as const;

export async function adjustVariantStock(
  req: AuthRequest,
  input: StockAdjustmentInput,
) {
  const { productId, sku, delta, reason, note, costPrice, price } = input;
  const ctx = getRequestContext();

  if (!Types.ObjectId.isValid(productId)) {
    throw new AppError("Invalid product id.", 400);
  }

  const hasFinancialUpdate =
    typeof costPrice === "number" || typeof price === "number";
  const stockDelta = Number.isFinite(delta) ? delta! : 0;

  if (!Number.isFinite(stockDelta) && !hasFinancialUpdate) {
    throw new AppError(
      "Must provide either a delta or a financial update (costPrice/price).",
      400,
    );
  }

  if (!VALID_REASONS.includes(reason as (typeof VALID_REASONS)[number])) {
    throw new AppError(
      `reason must be one of: ${VALID_REASONS.join(", ")}`,
      400,
    );
  }

  const product = await runInTransaction(async (session) => {
    const doc = await Product.findById(productId).session(session);
    if (!doc) throw new AppError("Product not found.", 404);

    const variantIdx = doc.variants.findIndex((v) => v.sku === sku);
    if (variantIdx === -1) throw new AppError("Variant SKU not found.", 404);

    const variant = doc.variants[variantIdx]!;

    if (Number.isFinite(stockDelta) && stockDelta !== 0) {
      const newStock = variant.stock + stockDelta;
      if (newStock < 0) {
        throw new AppError(
          `Cannot reduce stock below 0. Current stock: ${variant.stock}.`,
          400,
        );
      }
      variant.stock = newStock;
    }

    if (typeof costPrice === "number") variant.costPrice = costPrice;
    if (typeof price === "number") variant.price = price;

    doc.totalStock = doc.variants.reduce((acc, v) => acc + v.stock, 0);
    await doc.save({ session });
    await syncProductTotalStock(productId, session);

    if (stockDelta !== 0) {
      const ledger = await buildLedgerFromProduct(
        productId,
        sku,
        stockDelta,
        {
          reason: reason as
            | "purchase"
            | "sale_return"
            | "damage"
            | "manual_correction"
            | "opening_stock",
          referenceType: "manual",
          actor: req.user?._id,
          note,
          stockAfter: variant.stock,
        },
        session,
      );
      if (ledger) await insertLedgerEntries([ledger], session);
    }

    return doc;
  }, "inventory.stock.adjust");

  await writeAdminAudit(req, "inventory.stock.adjusted", {
    productId,
    sku,
    delta: stockDelta || 0,
    reason,
    newStock: product.variants.find((v) => v.sku === sku)?.stock,
    costPrice,
    price,
  });

  recordInventoryMetric("inventory.stock.adjusted", {
    productId,
    sku,
    requestId: ctx?.requestId,
  });

  scheduleInventorySummaryInvalidation();
  if (stockDelta !== 0 || hasFinancialUpdate) {
    await invalidatePdpForProductId(productId);
  }

  logger.info({
    msg: "inventory_stock_adjusted",
    requestId: ctx?.requestId,
    productId,
    sku,
    actorId: req.user?._id ? String(req.user._id) : undefined,
    delta: stockDelta,
  });

  return product;
}
