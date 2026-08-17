import Category from '../../models/Category';
import SubCategory from '../../models/SubCategory';
import type { ProductPriceInput } from './salePriceService';

const QUERY_MAX_MS = Number(process.env.SALE_QUERY_MAX_MS || 5000);

function normName(value?: string | null): string {
  return String(value || '')
    .trim()
    .toLowerCase();
}

export type SaleScopeContext = {
  categoryIdByName: Map<string, string>;
  subcategoryIdByName: Map<string, string>;
};

export async function buildSaleScopeContext(
  products: Array<Record<string, unknown>>,
): Promise<SaleScopeContext> {
  const categoryNames = new Set<string>();
  const subcategoryNames = new Set<string>();

  for (const product of products) {
    if (!product.categoryId && product.category) {
      categoryNames.add(String(product.category).trim());
    }
    if (!product.subcategoryId && product.subcategory) {
      subcategoryNames.add(String(product.subcategory).trim());
    }
  }

  const categoryIdByName = new Map<string, string>();
  const subcategoryIdByName = new Map<string, string>();

  if (categoryNames.size) {
    const categories = await Category.find({
      name: { $in: [...categoryNames] },
    })
      .select('_id name')
      .maxTimeMS(QUERY_MAX_MS)
      .lean<{ _id: unknown; name: string }[]>();

    for (const cat of categories) {
      categoryIdByName.set(normName(cat.name), String(cat._id));
    }
  }

  if (subcategoryNames.size) {
    const subcategories = await SubCategory.find({
      name: { $in: [...subcategoryNames] },
    })
      .select('_id name')
      .maxTimeMS(QUERY_MAX_MS)
      .lean<{ _id: unknown; name: string }[]>();

    for (const sub of subcategories) {
      subcategoryIdByName.set(normName(sub.name), String(sub._id));
    }
  }

  return { categoryIdByName, subcategoryIdByName };
}

export type ProductScopeSource = ProductPriceInput & {
  category?: string | null;
  subcategory?: string | null;
};

/** Resolve legacy string category/subcategory to FK ids for scoped sales. */
export function resolveProductScopeIds(
  product: ProductScopeSource,
  ctx?: SaleScopeContext,
): ProductPriceInput {
  let categoryId = product.categoryId ? String(product.categoryId) : null;
  let subcategoryId = product.subcategoryId ? String(product.subcategoryId) : null;

  if (!subcategoryId && product.subcategory && ctx) {
    subcategoryId =
      ctx.subcategoryIdByName.get(normName(product.subcategory)) ?? null;
  }
  if (!categoryId && product.category && ctx) {
    categoryId = ctx.categoryIdByName.get(normName(product.category)) ?? null;
  }

  return {
    _id: product._id,
    price: product.price,
    comparePrice: product.comparePrice,
    categoryId,
    subcategoryId,
  };
}
