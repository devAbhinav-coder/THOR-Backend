import mongoose from 'mongoose';
import Product from '../../models/Product';
import Category from '../../models/Category';
import SubCategory from '../../models/SubCategory';
import type { CouponLineScope } from './couponBusinessRules';
import { COUPON_QUERY_MAX_MS } from './couponBusinessRules';

type LineLike = {
  product: mongoose.Types.ObjectId | string | { _id?: mongoose.Types.ObjectId | string };
  price: number;
  quantity: number;
};

type ProductLean = {
  _id: mongoose.Types.ObjectId;
  categoryId?: mongoose.Types.ObjectId | null;
  subcategoryId?: mongoose.Types.ObjectId | null;
  category?: string | null;
  subcategory?: string | null;
};

function productIdOf(line: LineLike): string {
  const p = line.product as unknown;
  if (p && typeof p === 'object' && '_id' in (p as object)) {
    return String((p as { _id: unknown })._id);
  }
  return String(p);
}

function normName(value?: string | null): string {
  return String(value || '')
    .trim()
    .toLowerCase();
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function nameMatchFilter(names: string[]) {
  const unique = [...new Set(names.map((n) => n.trim()).filter(Boolean))];
  if (!unique.length) return null;
  return {
    $or: unique.map((name) => ({
      name: { $regex: `^${escapeRegex(name)}$`, $options: 'i' },
    })),
  };
}

/**
 * Resolve category/subcategory for cart or checkout lines via Product lookup.
 * Legacy products may only have string `category` / `subcategory` — resolve FK ids
 * so scoped coupons (category / subcategory) apply correctly.
 */
export async function buildCouponLinesFromCartItems(
  items: LineLike[]
): Promise<CouponLineScope[]> {
  if (!items.length) return [];

  const productIds = [
    ...new Set(items.map(productIdOf).filter((id) => mongoose.Types.ObjectId.isValid(id))),
  ];

  const products = await Product.find({ _id: { $in: productIds } })
    .select('categoryId subcategoryId category subcategory')
    .maxTimeMS(COUPON_QUERY_MAX_MS)
    .lean<ProductLean[]>();

  const byId = new Map(products.map((p) => [String(p._id), p]));

  const namesNeedingCategory = new Set<string>();
  const namesNeedingSubcategory = new Set<string>();
  const subcategoryIdsNeedingParent = new Set<string>();

  for (const product of products) {
    if (!product.categoryId && product.category) {
      namesNeedingCategory.add(String(product.category).trim());
    }
    if (!product.subcategoryId && product.subcategory) {
      namesNeedingSubcategory.add(String(product.subcategory).trim());
    }
    if (product.subcategoryId && !product.categoryId) {
      subcategoryIdsNeedingParent.add(String(product.subcategoryId));
    }
  }

  const categoryNameFilter = nameMatchFilter([...namesNeedingCategory]);
  const subcategoryNameFilter = nameMatchFilter([...namesNeedingSubcategory]);

  const [categories, subcategoriesByName, subcategoriesById] = await Promise.all([
    categoryNameFilter ?
      Category.find(categoryNameFilter)
        .select('_id name')
        .maxTimeMS(COUPON_QUERY_MAX_MS)
        .lean<{ _id: mongoose.Types.ObjectId; name: string }[]>()
    : Promise.resolve([] as { _id: mongoose.Types.ObjectId; name: string }[]),
    subcategoryNameFilter ?
      SubCategory.find(subcategoryNameFilter)
        .select('_id name categoryId')
        .maxTimeMS(COUPON_QUERY_MAX_MS)
        .lean<
          { _id: mongoose.Types.ObjectId; name: string; categoryId: mongoose.Types.ObjectId }[]
        >()
    : Promise.resolve(
        [] as { _id: mongoose.Types.ObjectId; name: string; categoryId: mongoose.Types.ObjectId }[],
      ),
    subcategoryIdsNeedingParent.size ?
      SubCategory.find({
        _id: {
          $in: [...subcategoryIdsNeedingParent].map((id) => new mongoose.Types.ObjectId(id)),
        },
      })
        .select('_id categoryId')
        .maxTimeMS(COUPON_QUERY_MAX_MS)
        .lean<{ _id: mongoose.Types.ObjectId; categoryId: mongoose.Types.ObjectId }[]>()
    : Promise.resolve([] as { _id: mongoose.Types.ObjectId; categoryId: mongoose.Types.ObjectId }[]),
  ]);

  const categoryIdByName = new Map(
    categories.map((c) => [normName(c.name), String(c._id)]),
  );
  const subcategoryByName = new Map(
    subcategoriesByName.map((s) => [
      normName(s.name),
      { id: String(s._id), categoryId: String(s.categoryId) },
    ]),
  );
  const parentCategoryBySubId = new Map(
    subcategoriesById.map((s) => [String(s._id), String(s.categoryId)]),
  );

  return items.map((item) => {
    const productId = productIdOf(item);
    const product = byId.get(productId);

    let categoryId = product?.categoryId ? String(product.categoryId) : null;
    let subcategoryId = product?.subcategoryId ? String(product.subcategoryId) : null;
    const categoryName = product?.category ? String(product.category).trim() : null;
    const subcategoryName = product?.subcategory ? String(product.subcategory).trim() : null;

    if (!subcategoryId && subcategoryName) {
      const hit = subcategoryByName.get(normName(subcategoryName));
      if (hit) {
        subcategoryId = hit.id;
        if (!categoryId) categoryId = hit.categoryId;
      }
    }

    if (!categoryId && categoryName) {
      categoryId = categoryIdByName.get(normName(categoryName)) || null;
    }

    if (!categoryId && subcategoryId) {
      categoryId = parentCategoryBySubId.get(subcategoryId) || null;
      if (!categoryId) {
        const hit = subcategoryByName.get(normName(subcategoryName));
        if (hit) categoryId = hit.categoryId;
      }
    }

    return {
      productId,
      categoryId,
      subcategoryId,
      categoryName,
      subcategoryName,
      unitPrice: Number(item.price),
      quantity: Number(item.quantity),
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
