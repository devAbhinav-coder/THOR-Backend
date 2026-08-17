import { roundMoney } from "../../types/utils/financialMath";

export interface VariantLike {
  stock?: number;
  costPrice?: number;
  price?: number;
}

/** Stock-weighted average cost across variants with cost > 0 and stock > 0. */
export function computeAvgCost(
  variants: VariantLike[],
  fallback = 0,
): number {
  let costWeightedSum = 0;
  let costWeightUnits = 0;

  for (const v of variants) {
    const stock = Number(v.stock ?? 0);
    const cost = Number(v.costPrice ?? 0);
    if (cost > 0 && stock > 0) {
      costWeightedSum += cost * stock;
      costWeightUnits += stock;
    }
  }

  if (costWeightUnits > 0) {
    return roundMoney(costWeightedSum / costWeightUnits);
  }

  const firstCost = variants.find(
    (v) => typeof v.costPrice === "number" && v.costPrice > 0,
  )?.costPrice;
  return roundMoney(firstCost ?? fallback);
}

/**
 * Effective sell price for catalog revenue estimate.
 * Uses average of variant MRPs when they differ; falls back to product.price.
 */
export function computeEffectiveSellPrice(
  productPrice: number,
  variants: VariantLike[],
): { sellPrice: number; hasVariantPriceSpread: boolean } {
  const base = Number(productPrice ?? 0);
  const variantPrices = variants
    .map((v) => Number(v.price ?? base))
    .filter((p) => p > 0);

  if (variantPrices.length === 0) {
    return { sellPrice: roundMoney(base), hasVariantPriceSpread: false };
  }

  const avg =
    variantPrices.reduce((sum, p) => sum + p, 0) / variantPrices.length;
  const rounded = roundMoney(avg);
  const uniqueCents = new Set(variantPrices.map((p) => Math.round(p * 100)));
  return {
    sellPrice: rounded > 0 ? rounded : roundMoney(base),
    hasVariantPriceSpread: uniqueCents.size > 1,
  };
}

export function computeTurnover(
  soldCount: number,
  totalStock: number,
): number | null {
  if (totalStock > 0) return soldCount / totalStock;
  if (soldCount > 0) return null; // sold out — no meaningful ratio
  return 0;
}

export function computeCatalogProfitMetrics(
  soldCount: number,
  sellPrice: number,
  avgCost: number,
) {
  const grossRevenue = roundMoney(soldCount * sellPrice);
  const grossCostOfSales = roundMoney(soldCount * avgCost);
  const grossProfit = roundMoney(grossRevenue - grossCostOfSales);
  const marginPercent =
    sellPrice > 0 && avgCost > 0 ?
      Math.round(((sellPrice - avgCost) / sellPrice) * 100)
    : null;

  return {
    grossRevenue,
    grossCostOfSales,
    grossProfit,
    marginPercent,
    estimatedRevenue: grossRevenue,
    estimatedCost: grossCostOfSales,
    estimatedProfit: grossProfit,
  };
}

export interface VariantSoldLike extends VariantLike {
  soldCount?: number;
}

/**
 * Lifetime catalog estimate: Σ (variant.soldCount × variant list price/cost).
 * Falls back to product-level avg when SKU sold counts are not populated.
 */
export function computeCatalogProfitFromVariants(
  productPrice: number,
  productSoldCount: number,
  variants: VariantSoldLike[],
) {
  const base = Number(productPrice ?? 0);
  let grossRevenue = 0;
  let grossCostOfSales = 0;
  let variantSoldTotal = 0;

  for (const v of variants) {
    const units = Math.max(0, Number(v.soldCount ?? 0));
    if (units <= 0) continue;
    variantSoldTotal += units;
    const sell = Number(v.price ?? base) || base;
    const cost = Math.max(0, Number(v.costPrice ?? 0));
    grossRevenue += units * sell;
    grossCostOfSales += units * cost;
  }

  if (variantSoldTotal <= 0 && productSoldCount > 0) {
    const { sellPrice } = computeEffectiveSellPrice(base, variants);
    const avgCost = computeAvgCost(variants);
    return computeCatalogProfitMetrics(productSoldCount, sellPrice, avgCost);
  }

  grossRevenue = roundMoney(grossRevenue);
  grossCostOfSales = roundMoney(grossCostOfSales);
  const grossProfit = roundMoney(grossRevenue - grossCostOfSales);
  const marginPercent =
    grossRevenue > 0 ?
      Math.round((grossProfit / grossRevenue) * 100)
    : null;

  return {
    grossRevenue,
    grossCostOfSales,
    grossProfit,
    marginPercent,
    estimatedRevenue: grossRevenue,
    estimatedCost: grossCostOfSales,
    estimatedProfit: grossProfit,
  };
}
