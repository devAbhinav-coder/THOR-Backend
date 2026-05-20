import { recordCouponMetric, type CouponMetricName } from './couponMetricsService';
import { recordFailedCouponAttempt, isCouponValidationThrottled } from './couponAbuseService';

/** Aggregated analytics facade for admin dashboards and ops tooling. */
export const couponAnalyticsService = {
  recordMetric: recordCouponMetric,
  recordFailedAttempt: recordFailedCouponAttempt,
  isThrottled: isCouponValidationThrottled,
};

export type { CouponMetricName };
