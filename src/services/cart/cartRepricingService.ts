import mongoose from 'mongoose';
import Product from '../../models/Product';
import { getActiveSaleCampaigns } from '../sale/saleCacheService';
import { resolveVariantSellPrice } from '../sale/saleProductEnrichment';
import { buildSaleScopeContext } from '../sale/saleScopeResolver';
import { CART_QUERY_MAX_MS } from './cartConstants';
import type { ICartItem } from '../../types';

type ProductLean = {
  _id: mongoose.Types.ObjectId;
  price: number;
  comparePrice?: number | null;
  categoryId?: mongoose.Types.ObjectId | null;
  subcategoryId?: mongoose.Types.ObjectId | null;
  category?: string | null;
  subcategory?: string | null;
  variants?: Array<{ sku: string; price?: number }>;
};

/** Apply active sale campaign prices to cart line items. */
export async function repriceCartItemsWithActiveSales(
  items: ICartItem[],
): Promise<{ items: ICartItem[]; changed: boolean }> {
  if (!items.length) return { items, changed: false };

  const productIds = [
    ...new Set(items.map((item) => String(item.product)).filter(Boolean)),
  ];
  const products = await Product.find({
    _id: { $in: productIds.map((id) => new mongoose.Types.ObjectId(id)) },
  })
    .select('price comparePrice categoryId subcategoryId category subcategory variants')
    .maxTimeMS(CART_QUERY_MAX_MS)
    .lean<ProductLean[]>();

  const productMap = new Map(products.map((p) => [String(p._id), p]));
  const campaigns = await getActiveSaleCampaigns();
  const scopeCtx = await buildSaleScopeContext(products as unknown as Record<string, unknown>[]);
  let changed = false;

  const repriced = items.map((item) => {
    const product = productMap.get(String(item.product));
    if (!product) return item;

    const sku = String(item.variant?.sku || '').trim();
    const variant = product.variants?.find((v) => String(v.sku || '').trim() === sku);
    if (!variant) return item;

    const livePrice = resolveVariantSellPrice(
      {
        _id: String(product._id),
        price: Number(product.price) || 0,
        comparePrice: product.comparePrice,
        categoryId: product.categoryId ? String(product.categoryId) : null,
        subcategoryId: product.subcategoryId ? String(product.subcategoryId) : null,
        category: product.category ? String(product.category) : null,
        subcategory: product.subcategory ? String(product.subcategory) : null,
      },
      variant,
      campaigns,
      scopeCtx,
    );

    if (Math.abs(Number(item.price) - livePrice) > 0.001) {
      changed = true;
      return { ...item, price: livePrice };
    }
    return item;
  });

  return { items: repriced, changed };
}
