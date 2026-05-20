/**
 * Backward-compatible barrel — controllers and legacy imports use `../services/cartService`.
 */
export {
  cartService,
  generateCustomizationHash,
  generateCartItemId,
  cartRevalidationService,
  cartSyncService,
  cartAnalyticsService,
} from './cart/cartService';
