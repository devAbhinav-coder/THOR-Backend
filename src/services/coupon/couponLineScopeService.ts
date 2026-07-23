import mongoose from 'mongoose';
import Product from '../../models/Product';
import type { CouponLineScope } from './couponBusinessRules';
import { COUPON_QUERY_MAX_MS } from './couponBusinessRules';

type LineLike = {
  product: mongoose.Types.ObjectId | string | { _id?: mongoose.Types.ObjectId | string };
  price: number;
  quantity: number;
};

function productIdOf(line: LineLike): string {
  const p = line.product as unknown;
  if (p && typeof p === 'object' && '_id' in (p as object)) {
    return String((p as { _id: unknown })._id);
  }
  return String(p);
}

/** Resolve category/subcategory for cart or checkout lines via Product lookup. */
export async function buildCouponLinesFromCartItems(
  items: LineLike[]
): Promise<CouponLineScope[]> {
  if (!items.length) return [];

  const productIds = [
    ...new Set(items.map(productIdOf).filter((id) => mongoose.Types.ObjectId.isValid(id))),
  ];

  const products = await Product.find({ _id: { $in: productIds } })
    .select('categoryId subcategoryId')
    .maxTimeMS(COUPON_QUERY_MAX_MS)
    .lean<{ _id: mongoose.Types.ObjectId; categoryId?: mongoose.Types.ObjectId; subcategoryId?: mongoose.Types.ObjectId }[]>();

  const byId = new Map(products.map((p) => [String(p._id), p]));

  return items.map((item) => {
    const productId = productIdOf(item);
    const product = byId.get(productId);
    return {
      productId,
      categoryId: product?.categoryId ? String(product.categoryId) : null,
      subcategoryId: product?.subcategoryId ? String(product.subcategoryId) : null,
      lineTotal: Number(item.price) * Number(item.quantity),
    };
  });
}

export async function buildCouponLinesFromProductIds(
  entries: Array<{ productId: string; price: number; quantity: number }>
): Promise<CouponLineScope[]> {
  return buildCouponLinesFromCartItems(
    entries.map((e) => ({
      product: e.productId,
      price: e.price,
      quantity: e.quantity,
    }))
  );
}
