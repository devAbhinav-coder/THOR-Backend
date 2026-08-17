import { OFFLINE_MANUAL_VARIANT_SKU } from "../constants/offlineOrder";
import { OFFLINE_MANUAL_ITEM_SLUG } from "../services/orderProfitAggregationHelpers";

export function isManualOfflineOrderItem(item: {
  slug?: string;
  isOfflineManual?: boolean;
  variant?: { sku?: string };
}): boolean {
  return (
    item.isOfflineManual === true ||
    item.slug === OFFLINE_MANUAL_ITEM_SLUG ||
    item.variant?.sku === OFFLINE_MANUAL_VARIANT_SKU
  );
}

export function isManualLineMissingCost(item: {
  slug?: string;
  isOfflineManual?: boolean;
  variant?: { sku?: string };
  costAtSale?: number | null;
}): boolean {
  return (
    isManualOfflineOrderItem(item) && !(Number(item.costAtSale ?? 0) > 0)
  );
}
