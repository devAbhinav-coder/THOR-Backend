import type { SaleCampaignLike } from './salePriceService';
import { applyCampaignDiscount, resolveEffectivePrice } from './salePriceService';
import {
  buildSaleScopeContext,
  type SaleScopeContext,
} from './saleScopeResolver';

type VariantRow = Record<string, unknown> & {
  price?: number;
  sku?: string;
};

/** Storefront/cart sell price for one SKU (catalog DB prices + active campaigns). */
export function resolveVariantSellPrice(
  product: {
    _id?: string;
    price: number;
    comparePrice?: number | null;
    categoryId?: string | null;
    subcategoryId?: string | null;
    category?: string | null;
    subcategory?: string | null;
  },
  variant: { price?: number | null },
  campaigns: SaleCampaignLike[],
  scopeCtx?: SaleScopeContext,
): number {
  const listBase = Number(product.price) || 0;
  const resolved = resolveEffectivePrice(
    {
      _id: product._id,
      price: listBase,
      comparePrice: product.comparePrice,
      categoryId: product.categoryId,
      subcategoryId: product.subcategoryId,
      category: product.category,
      subcategory: product.subcategory,
    },
    campaigns,
    new Date(),
    scopeCtx,
  );
  const variantList =
    typeof variant.price === 'number' && variant.price >= 0 ?
      variant.price
    : listBase;
  if (resolved.winningCampaign) {
    return applyCampaignDiscount(variantList, resolved.winningCampaign);
  }
  return variantList;
}

function enrichVariantRows(
  variants: VariantRow[],
  listBase: number,
  resolved: ReturnType<typeof resolveEffectivePrice>,
): VariantRow[] {
  const campaign = resolved.winningCampaign;
  const productMrp =
    resolved.comparePrice != null && resolved.comparePrice > 0 ?
      resolved.comparePrice
    : null;

  return variants.map((row) => {
    const variantList =
      typeof row.price === 'number' && row.price >= 0 ? row.price : listBase;
    let sell = variantList;
    if (campaign) {
      sell = applyCampaignDiscount(variantList, campaign);
    }

    const mrpCandidate = Math.max(productMrp ?? 0, variantList, listBase);
    const mrp = mrpCandidate > sell ? mrpCandidate : null;

    return {
      ...row,
      sellPrice: sell,
      listPrice: variantList,
      ...(mrp != null ? { mrp } : {}),
    };
  });
}

/** Attach effective sale pricing fields onto product documents for API responses. */
export function enrichProductsWithSalePricing<T extends Record<string, unknown>>(
  products: T[],
  campaigns: SaleCampaignLike[],
  scopeCtx?: SaleScopeContext,
): T[] {
  if (!products.length) return products;
  return products.map((product) => {
    const listBase = Number(product.price) || 0;
    const resolved = resolveEffectivePrice(
      {
        _id: product._id as string | undefined,
        price: listBase,
        comparePrice: product.comparePrice as number | null | undefined,
        categoryId: product.categoryId as string | null | undefined,
        subcategoryId: product.subcategoryId as string | null | undefined,
        category: product.category as string | null | undefined,
        subcategory: product.subcategory as string | null | undefined,
      },
      campaigns,
      new Date(),
      scopeCtx,
    );

    const next: Record<string, unknown> = { ...product };
    const rawVariants = Array.isArray(product.variants) ?
      (product.variants as VariantRow[])
    : [];
    const enrichedVariants = enrichVariantRows(rawVariants, listBase, resolved);
    next.variants = enrichedVariants;

    const sellPrices = enrichedVariants.map((v) => Number(v.sellPrice ?? listBase));
    const sellMin = sellPrices.length ? Math.min(...sellPrices) : listBase;
    const sellMax = sellPrices.length ? Math.max(...sellPrices) : listBase;
    const sellCents = new Set(sellPrices.map((p) => Math.round(p * 100)));

    next.sellPriceMin = sellMin;
    next.sellPriceMax = sellMax;
    next.hasVariantPriceSpread = sellCents.size > 1;
    next.catalogBasePrice = listBase;

    if (resolved.saleCampaignId) {
      next.effectivePrice = resolved.effectivePrice;
      next.saleBadge = resolved.saleBadge;
      next.saleCampaignId = resolved.saleCampaignId;
      next.price = sellMin;
      if (resolved.effectivePrice < listBase) {
        next.comparePrice =
          resolved.comparePrice != null && resolved.comparePrice > listBase ?
            resolved.comparePrice
          : listBase;
      }
      if (resolved.discountPercent != null) {
        next.discountPercent = resolved.discountPercent;
      }
    } else {
      next.price = sellMin;
      next.saleBadge = null;
      next.saleCampaignId = null;
      next.effectivePrice = undefined;
      if (
        typeof next.comparePrice === 'number' &&
        Number(next.comparePrice) > sellMin
      ) {
        next.discountPercent = Math.round(
          ((Number(next.comparePrice) - sellMin) / Number(next.comparePrice)) * 100,
        );
      }
    }

    return next as T;
  });
}

export async function enrichProductsWithSalePricingAsync<T extends Record<string, unknown>>(
  products: T[],
  campaigns: SaleCampaignLike[],
): Promise<T[]> {
  if (!products.length) return products;
  const scopeCtx = await buildSaleScopeContext(products);
  return enrichProductsWithSalePricing(products, campaigns, scopeCtx);
}
