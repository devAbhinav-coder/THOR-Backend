import { recordCartMetric, type CartMetricName } from './cartMetricsService';

/** Structured analytics facade over cart metrics (dashboards, alerts). */
export const cartAnalyticsService = {
  trackAbandonment(userId: string): void {
    recordCartMetric('cart.abuse.suspicious', { userId, phase: 'abandoned_signal' });
  },

  trackCouponApply(success: boolean, userId: string, couponCode?: string): void {
    recordCartMetric(success ? 'cart.coupon.applied' : 'cart.coupon.apply_failed', {
      userId,
      couponCode,
    });
  },

  trackQuantityUpdate(userId: string, cartItemId: string): void {
    recordCartMetric('cart.item.updated', { userId, cartItemId });
  },

  trackGiftingAdd(userId: string, productId: string): void {
    recordCartMetric('cart.item.added', { userId, productId, gifting: true });
  },

  trackMetric(name: CartMetricName, labels: Record<string, string | number | boolean | undefined> = {}): void {
    recordCartMetric(name, labels);
  },
};
