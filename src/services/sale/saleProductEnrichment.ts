import type { SaleCampaignLike } from './salePriceService';
import { resolveEffectivePrice } from './salePriceService';

/** Attach effective sale pricing fields onto product documents for API responses. */
export function enrichProductsWithSalePricing<T extends Record<string, unknown>>(
  products: T[],
  campaigns: SaleCampaignLike[]
): T[] {
  if (!products.length) return products;
  return products.map((product) => {
    const resolved = resolveEffectivePrice(
      {
        _id: product._id as string | undefined,
        price: Number(product.price) || 0,
        comparePrice: product.comparePrice as number | null | undefined,
        categoryId: product.categoryId as string | null | undefined,
        subcategoryId: product.subcategoryId as string | null | undefined,
      },
      campaigns
    );

    const next: Record<string, unknown> = { ...product };
    if (resolved.saleCampaignId) {
      next.effectivePrice = resolved.effectivePrice;
      next.saleBadge = resolved.saleBadge;
      next.saleCampaignId = resolved.saleCampaignId;
      // Surface campaign price as selling price for storefront consumers
      if (resolved.effectivePrice < resolved.basePrice) {
        if (resolved.comparePrice == null) {
          next.comparePrice = resolved.basePrice;
        }
        next.price = resolved.effectivePrice;
      }
    } else if (resolved.onSale) {
      next.saleBadge = resolved.saleBadge;
    }
    if (resolved.discountPercent != null) {
      next.discountPercent = resolved.discountPercent;
    }
    return next as T;
  });
}
