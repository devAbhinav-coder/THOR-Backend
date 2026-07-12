/** Products with comparePrice above selling price (storefront “on sale”). */
export function onSaleMongoClause(): Record<string, unknown> {
  return {
    comparePrice: { $exists: true, $ne: null, $gt: 0 },
    $expr: { $gt: ["$comparePrice", "$price"] },
  };
}

export function mergeOnSaleFilter(
  base: Record<string, unknown>,
  onSale?: boolean,
): Record<string, unknown> {
  if (!onSale) return base;
  return { ...base, ...onSaleMongoClause() };
}
