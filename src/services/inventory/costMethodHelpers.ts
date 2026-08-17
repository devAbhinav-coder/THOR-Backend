import { roundMoney } from "../../types/utils/financialMath";

/** Weighted-average cost when receiving new stock (industry standard WAC). */
export function computeWeightedAverageCost(
  currentStock: number,
  currentCost: number,
  incomingQty: number,
  incomingUnitCost: number,
): number {
  const newStock = currentStock + incomingQty;
  if (newStock <= 0) return roundMoney(incomingUnitCost);
  if (currentStock <= 0 || currentCost <= 0) {
    return roundMoney(incomingUnitCost);
  }
  return roundMoney(
    (currentStock * currentCost + incomingQty * incomingUnitCost) / newStock,
  );
}

export type CostUpdateMethod = "weighted" | "replace";

export function resolveCostAfterPurchase(
  currentStock: number,
  currentCost: number,
  incomingQty: number,
  incomingUnitCost: number,
  method: CostUpdateMethod = "weighted",
): number {
  if (method === "replace") return roundMoney(incomingUnitCost);
  return computeWeightedAverageCost(
    currentStock,
    currentCost,
    incomingQty,
    incomingUnitCost,
  );
}
