import mongoose, { ClientSession } from 'mongoose';
import Product from '../models/Product';

type SessionOpt = { session?: ClientSession };

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
        soldCount: quantity,
      },
    },
    {
      ...(opts?.session ? { session: opts.session } : {}),
      arrayFilters: [{ 'v.sku': sku, 'v.stock': { $gte: quantity } }],
    }
  );
  return res.modifiedCount === 1;
}

/** Restore stock (cancel / refund). No upper bound check. */
export async function incrementVariantStock(
  productId: mongoose.Types.ObjectId | string,
  sku: string,
  quantity: number,
  opts?: SessionOpt
): Promise<boolean> {
  if (quantity <= 0) return true;
  const res = await Product.updateOne(
    {
      _id: productId,
      variants: { $elemMatch: { sku } },
    },
    {
      $inc: {
        totalStock: quantity,
        'variants.$[v].stock': quantity,
        soldCount: -quantity,
      },
    },
    {
      ...(opts?.session ? { session: opts.session } : {}),
      arrayFilters: [{ 'v.sku': sku }],
    }
  );
  return res.modifiedCount === 1;
}
