/**
 * Shipping and COD convenience fees are not refunded on returns / goodwill refunds;
 * only the product-value portion (total minus these charges) is eligible.
 */
export function getNonRefundableFeesInr(order: {
  shippingCharge?: number;
  codFee?: number;
}): number {
  const ship = Math.max(0, Number(order.shippingCharge ?? 0));
  const cod = Math.max(0, Number(order.codFee ?? 0));
  return ship + cod;
}

export function getMaxRefundableInr(order: {
  total: number;
  shippingCharge?: number;
  codFee?: number;
}): number {
  const t = Number(order.total);
  if (!Number.isFinite(t) || t < 0) return 0;
  return Math.max(0, t - getNonRefundableFeesInr(order));
}
