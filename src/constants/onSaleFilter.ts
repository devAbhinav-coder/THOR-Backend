import mongoose from 'mongoose';
import { collectCampaignScopeIds, type SaleCampaignLike } from '../services/sale/salePriceService';

/** Products with comparePrice above selling price (legacy catalog MRP). */
export function comparePriceOnSaleClause(): Record<string, unknown> {
  return {
    comparePrice: { $exists: true, $ne: null, $gt: 0 },
    $expr: { $gt: ['$comparePrice', '$price'] },
  };
}

/** @deprecated use buildOnSaleMongoFilter */
export function onSaleMongoClause(): Record<string, unknown> {
  return comparePriceOnSaleClause();
}

export function buildCampaignCoverageClause(
  campaigns: SaleCampaignLike[],
): Record<string, unknown> | null {
  if (!campaigns.length) return null;
  const scopes = collectCampaignScopeIds(campaigns);
  if (scopes.all) {
    return { isActive: true };
  }
  const or: Record<string, unknown>[] = [];
  if (scopes.categoryIds.length) {
    or.push({
      categoryId: {
        $in: scopes.categoryIds.map((id) => new mongoose.Types.ObjectId(id)),
      },
    });
  }
  if (scopes.subcategoryIds.length) {
    or.push({
      subcategoryId: {
        $in: scopes.subcategoryIds.map((id) => new mongoose.Types.ObjectId(id)),
      },
    });
  }
  if (scopes.productIds.length) {
    or.push({
      _id: {
        $in: scopes.productIds.map((id) => new mongoose.Types.ObjectId(id)),
      },
    });
  }
  if (!or.length) return null;
  return { $or: or };
}

/** Admin sale filter — only products covered by an active sale campaign. */
export function buildOnSaleMongoFilter(
  campaigns: SaleCampaignLike[],
): Record<string, unknown> {
  const campaignClause = buildCampaignCoverageClause(campaigns);
  if (!campaignClause) {
    return { _id: { $in: [] } };
  }
  if ('isActive' in campaignClause && !('$or' in campaignClause)) {
    return { isActive: true };
  }
  return campaignClause;
}

export function mergeOnSaleFilter(
  base: Record<string, unknown>,
  onSale?: boolean,
  campaigns: SaleCampaignLike[] = [],
): Record<string, unknown> {
  if (!onSale) return base;
  const saleFilter = buildOnSaleMongoFilter(campaigns);
  if (!Object.keys(saleFilter).length) return base;
  return { $and: [base, saleFilter] };
}

export function buildHasOfferMongoFilter(scopes: {
  categoryIds: string[];
  subcategoryIds: string[];
  productIds: string[];
}): Record<string, unknown> | null {
  const or: Record<string, unknown>[] = [];
  if (scopes.categoryIds.length) {
    or.push({
      categoryId: {
        $in: scopes.categoryIds.map((id) => new mongoose.Types.ObjectId(id)),
      },
    });
  }
  if (scopes.subcategoryIds.length) {
    or.push({
      subcategoryId: {
        $in: scopes.subcategoryIds.map((id) => new mongoose.Types.ObjectId(id)),
      },
    });
  }
  if (scopes.productIds.length) {
    or.push({
      _id: {
        $in: scopes.productIds.map((id) => new mongoose.Types.ObjectId(id)),
      },
    });
  }
  if (!or.length) return null;
  return { $or: or };
}

export function mergeHasOfferFilter(
  base: Record<string, unknown>,
  hasOffer: boolean | undefined,
  scopes: {
    categoryIds: string[];
    subcategoryIds: string[];
    productIds: string[];
  },
): Record<string, unknown> {
  if (!hasOffer) return base;
  const offerFilter = buildHasOfferMongoFilter(scopes);
  if (!offerFilter) {
    return { ...base, _id: { $in: [] } };
  }
  return { $and: [base, offerFilter] };
}
