import mongoose, { ClientSession, Types } from 'mongoose';
import Product from '../models/Product';
import StockLedger, { StockChangeReason } from '../models/StockLedger';
import { schedulePdpInvalidationForProductId } from './productCacheService';

type SessionOpt = { session?: ClientSession };

export interface StockMovementOpts {
  reason: StockChangeReason;
  referenceId?: Types.ObjectId | string;
  referenceType?: 'order' | 'purchase_invoice' | 'manual';
  actor?: Types.ObjectId | string;
  note?: string;
}

/**
 * Write a StockLedger entry for any inventory movement.
 * Call this after the actual stock mutation so stockAfter is accurate.
 */
export async function logStockMovement(
  productId: mongoose.Types.ObjectId | string,
  sku: string,
  delta: number,
  opts: StockMovementOpts
): Promise<void> {
  try {
    const product = await Product.findById(productId).select('name variants').lean();
    if (!product) return;
    const variant = (product.variants as { sku: string; stock: number; size?: string; color?: string }[]).find(
      (v) => v.sku === sku
    );
    const stockAfter = variant?.stock ?? 0;
    const parts: string[] = [];
    if (variant?.size) parts.push(variant.size);
    if (variant?.color) parts.push(variant.color);
    const variantLabel = parts.length > 0 ? parts.join(' / ') : sku;

    await StockLedger.create({
      product: productId,
      sku,
      productName: product.name,
      variantLabel,
      delta,
      stockAfter,
      reason: opts.reason,
      referenceId: opts.referenceId,
      referenceType: opts.referenceType,
      actor: opts.actor,
      note: opts.note,
    });
  } catch {
    // Non-critical — never fail the main flow
  }
}

/**
 * Atomically decrement stock for one variant when stock >= qty (arrayFilters, not positional $).
 * Also decrements denormalized totalStock in the same write.
 */
export async function decrementVariantStock(
  productId: mongoose.Types.ObjectId | string,
  sku: string,
  quantity: number,
  opts?: SessionOpt
): Promise<boolean> {
  if (quantity <= 0) return true;
  const res = await Product.updateOne(
    {
      _id: productId,
      isActive: true,
      variants: { $elemMatch: { sku, stock: { $gte: quantity } } },
    },
    {
      $inc: {
        totalStock: -quantity,
        'variants.$[v].stock': -quantity,
        'variants.$[v].soldCount': quantity,
        soldCount: quantity,
      },
    },
    {
      ...(opts?.session ? { session: opts.session } : {}),
      arrayFilters: [{ 'v.sku': sku, 'v.stock': { $gte: quantity } }],
    }
  );
  if (res.modifiedCount === 1) {
    schedulePdpInvalidationForProductId(productId);
  }
  return res.modifiedCount === 1;
}

/** Restore stock (cancel / refund). No upper bound check. */
export async function incrementVariantStock(
  productId: mongoose.Types.ObjectId | string,
  sku: string,
  quantity: number,
  opts?: SessionOpt & {
    variantLabel?: string;
    costPrice?: number;
    /** When reversing a sale (return/cancel), pass negative quantity to reduce soldCount. */
    soldCountDelta?: number;
  }
): Promise<boolean> {
  if (quantity <= 0) return true;

  const inc: Record<string, number> = {
    totalStock: quantity,
    'variants.$[v].stock': quantity,
  };
  if (typeof opts?.soldCountDelta === 'number' && opts.soldCountDelta !== 0) {
    inc.soldCount = opts.soldCountDelta;
    inc['variants.$[v].soldCount'] = opts.soldCountDelta;
  }

  // Try update existing
  const res = await Product.updateOne(
    {
      _id: productId,
      'variants.sku': sku,
    },
    {
      $inc: inc,
    },
    {
      ...(opts?.session ? { session: opts.session } : {}),
      arrayFilters: [{ 'v.sku': sku }],
    }
  );

  if (res.modifiedCount === 1) {
    schedulePdpInvalidationForProductId(productId);
    return true;
  }

  // If not found, it's a new variant for an existing product. Add it.
  const parts = opts?.variantLabel?.split('/') || [];
  const size = parts[0]?.trim() || '';
  const color = parts[1]?.trim() || '';

  const addRes = await Product.updateOne(
    { _id: productId, 'variants.sku': { $ne: sku } },
    {
      $push: {
        variants: {
          sku,
          size,
          color,
          stock: quantity,
          price: 0, 
          costPrice: opts?.costPrice || 0,
        },
      },
      $inc: { totalStock: quantity },
    },
    { ...(opts?.session ? { session: opts.session } : {}) }
  );

  if (addRes.modifiedCount === 1) {
    schedulePdpInvalidationForProductId(productId);
  }
  return addRes.modifiedCount === 1;
}
