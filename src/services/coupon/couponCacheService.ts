import { getCache, setCache, deleteCache, clearCachePattern } from '../cacheService';
import { CouponLike } from './couponBusinessRules';

const ACTIVE_COUPONS_KEY = 'cache:coupons:active';
const COUPON_BY_CODE_PREFIX = 'cache:coupon:code:';
const VALIDATION_PREFIX = 'cache:coupon:validate:';
/** v2: eligible list excludes showOnStorefront:false (code-only) coupons */
const ELIGIBLE_PREFIX = 'cache:coupon:eligible:v2:';
const ACTIVE_TTL = Number(process.env.COUPON_ACTIVE_CACHE_TTL_SEC || 300);
const CODE_TTL = Number(process.env.COUPON_CODE_CACHE_TTL_SEC || 600);
const VALIDATION_TTL = Number(process.env.COUPON_VALIDATION_CACHE_TTL_SEC || 60);
const ELIGIBLE_TTL = Number(process.env.COUPON_ELIGIBLE_CACHE_TTL_SEC || 45);

export function couponCodeCacheKey(code: string): string {
  return `${COUPON_BY_CODE_PREFIX}${code}`;
}

export function validationCacheKey(
  userId: string,
  code: string,
  orderAmount: number,
  scopeSuffix?: string,
): string {
  const suffix = scopeSuffix ? `:${scopeSuffix}` : '';
  return `${VALIDATION_PREFIX}${userId}:${code}:${orderAmount}${suffix}`;
}

export function eligibleCouponsCacheKey(
  userId: string,
  orderAmount: number,
  scopeSuffix?: string,
): string {
  const suffix = scopeSuffix ? `:${scopeSuffix}` : '';
  return `${ELIGIBLE_PREFIX}${userId}:${orderAmount}${suffix}`;
}

export type EligibleCouponsCachePayload = {
  coupons: CouponLike[];
  ineligible: Array<{ code: string; reason: string }>;
  completedOrders: number;
};

export async function getCachedEligibleCoupons(
  key: string,
): Promise<EligibleCouponsCachePayload | null> {
  return getCache<EligibleCouponsCachePayload>(key);
}

export async function setCachedEligibleCoupons(
  key: string,
  payload: EligibleCouponsCachePayload,
): Promise<void> {
  await setCache(key, payload, ELIGIBLE_TTL);
}

export async function getCachedCouponByCode(code: string): Promise<CouponLike | null> {
  return getCache<CouponLike>(couponCodeCacheKey(code));
}

export async function setCachedCouponByCode(code: string, coupon: CouponLike): Promise<void> {
  await setCache(couponCodeCacheKey(code), coupon, CODE_TTL);
}

export async function getCachedActiveCoupons(): Promise<CouponLike[] | null> {
  return getCache<CouponLike[]>(ACTIVE_COUPONS_KEY);
}

export async function setCachedActiveCoupons(coupons: CouponLike[]): Promise<void> {
  await setCache(ACTIVE_COUPONS_KEY, coupons, ACTIVE_TTL);
}

export async function getCachedValidationResult<T>(key: string): Promise<T | null> {
  return getCache<T>(key);
}

export async function setCachedValidationResult<T>(key: string, result: T): Promise<void> {
  await setCache(key, result, VALIDATION_TTL);
}

export async function invalidateCouponCaches(code?: string): Promise<void> {
  await deleteCache(ACTIVE_COUPONS_KEY);
  if (code) {
    await deleteCache(couponCodeCacheKey(code));
  }
  await clearCachePattern(`${VALIDATION_PREFIX}*`);
  await clearCachePattern(`${ELIGIBLE_PREFIX}*`);
  if (!code) {
    await clearCachePattern(`${COUPON_BY_CODE_PREFIX}*`);
  }
}
