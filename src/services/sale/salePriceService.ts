import mongoose from 'mongoose';
import type { PromoScopeType } from '../coupon/couponBusinessRules';
import { isWithinValidityWindow } from '../coupon/couponBusinessRules';
import type { SaleScopeContext, ProductScopeSource } from './saleScopeResolver';
import { resolveProductScopeIds } from './saleScopeResolver';

export type { SaleScopeContext, ProductScopeSource };

export type SaleCampaignLike = {
  _id?: mongoose.Types.ObjectId | string;
  name: string;
  description?: string;
  badgeText?: string;
  discountType: 'percentage' | 'flat' | 'fixed';
  discountValue: number;
  maxDiscountPerItem?: number;
  imageUrl?: string;
  imagePublicId?: string;
  showOnStorefront?: boolean;
  scopeType?: PromoScopeType;
  categoryIds?: (mongoose.Types.ObjectId | string)[];
  subcategoryIds?: (mongoose.Types.ObjectId | string)[];
  productIds?: (mongoose.Types.ObjectId | string)[];
  startDate: Date;
  endDate: Date;
  isActive: boolean;
  deletedAt?: Date | null;
  archivedAt?: Date | null;
};

export type ProductPriceInput = {
  _id?: mongoose.Types.ObjectId | string;
  price: number;
  comparePrice?: number | null;
  categoryId?: mongoose.Types.ObjectId | string | null;
  subcategoryId?: mongoose.Types.ObjectId | string | null;
};

function idSet(ids?: (mongoose.Types.ObjectId | string)[]): Set<string> {
  return new Set((ids || []).map((id) => String(id)).filter(Boolean));
}

export function campaignMatchesProduct(
  campaign: SaleCampaignLike,
  product: ProductScopeSource,
  ctx?: SaleScopeContext,
): boolean {
  const scoped = resolveProductScopeIds(product, ctx);
  const scope = campaign.scopeType || 'all';
  if (scope === 'all') return true;
  const productId = scoped._id ? String(scoped._id) : '';
  if (scope === 'products') {
    return productId ? idSet(campaign.productIds).has(productId) : false;
  }
  if (scope === 'categories') {
    if (!scoped.categoryId) return false;
    return idSet(campaign.categoryIds).has(String(scoped.categoryId));
  }
  if (scope === 'subcategories') {
    if (!scoped.subcategoryId) return false;
    return idSet(campaign.subcategoryIds).has(String(scoped.subcategoryId));
  }
  return false;
}

export function applyCampaignDiscount(
  basePrice: number,
  campaign: SaleCampaignLike,
): number {
  if (basePrice <= 0) return basePrice;
  let discounted = basePrice;
  if (campaign.discountType === 'percentage') {
    let off = (basePrice * campaign.discountValue) / 100;
    if (campaign.maxDiscountPerItem != null) {
      off = Math.min(off, campaign.maxDiscountPerItem);
    }
    discounted = basePrice - off;
  } else if (campaign.discountType === 'fixed') {
    discounted = Math.min(basePrice, Math.max(0, campaign.discountValue));
  } else {
    discounted = basePrice - campaign.discountValue;
  }
  return Math.max(0, Math.round(discounted * 100) / 100);
}

export function resolveEffectivePrice(
  product: ProductScopeSource,
  campaigns: SaleCampaignLike[],
  now = new Date(),
  ctx?: SaleScopeContext,
): {
  effectivePrice: number;
  basePrice: number;
  comparePrice: number | null;
  saleBadge: string | null;
  saleCampaignId: string | null;
  onSale: boolean;
  discountPercent: number | null;
  winningCampaign: SaleCampaignLike | null;
} {
  const basePrice = Number(product.price) || 0;
  const comparePrice =
    product.comparePrice != null && Number(product.comparePrice) > 0
      ? Number(product.comparePrice)
      : null;

  let bestPrice = basePrice;
  let bestCampaign: SaleCampaignLike | null = null;

  for (const campaign of campaigns) {
    if (!campaign.isActive || campaign.deletedAt || campaign.archivedAt) continue;
    if (!isWithinValidityWindow(campaign.startDate, campaign.endDate, now)) continue;
    if (!campaignMatchesProduct(campaign, product, ctx)) continue;
    const priced = applyCampaignDiscount(basePrice, campaign);
    if (priced < bestPrice) {
      bestPrice = priced;
      bestCampaign = campaign;
    }
  }

  const displayMrp = Math.max(comparePrice ?? basePrice, basePrice);
  const onSale = Boolean(bestCampaign);
  let discountPercent: number | null = null;
  if (bestCampaign && displayMrp > bestPrice && displayMrp > 0) {
    discountPercent = Math.round(((displayMrp - bestPrice) / displayMrp) * 100);
  }

  return {
    effectivePrice: bestCampaign ? bestPrice : basePrice,
    basePrice,
    comparePrice,
    saleBadge: bestCampaign ? bestCampaign.badgeText || 'Sale' : null,
    saleCampaignId: bestCampaign?._id ? String(bestCampaign._id) : null,
    onSale,
    discountPercent,
    winningCampaign: bestCampaign,
  };
}

export function collectCampaignScopeIds(campaigns: SaleCampaignLike[]): {
  all: boolean;
  categoryIds: string[];
  subcategoryIds: string[];
  productIds: string[];
} {
  let all = false;
  const categoryIds = new Set<string>();
  const subcategoryIds = new Set<string>();
  const productIds = new Set<string>();

  for (const c of campaigns) {
    const scope = c.scopeType || 'all';
    if (scope === 'all') {
      all = true;
      continue;
    }
    for (const id of c.categoryIds || []) categoryIds.add(String(id));
    for (const id of c.subcategoryIds || []) subcategoryIds.add(String(id));
    for (const id of c.productIds || []) productIds.add(String(id));
  }

  return {
    all,
    categoryIds: [...categoryIds],
    subcategoryIds: [...subcategoryIds],
    productIds: [...productIds],
  };
}
