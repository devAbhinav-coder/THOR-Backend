import Order from '../../models/Order';
import { getCache, setCache, deleteCache } from '../cacheService';
import { redisEnabled, redisConnection } from '../../config/redis';
import { COUPON_QUERY_MAX_MS } from './couponBusinessRules';

const DELIVERED_COUNT_PREFIX = 'cache:user:deliveredOrders:';
const DELIVERED_TTL = Number(process.env.COUPON_USER_STATS_TTL_SEC || 300);

function deliveredCountKey(userId: string): string {
  return `${DELIVERED_COUNT_PREFIX}${userId}`;
}

export async function getUserDeliveredOrderCount(userId: string): Promise<number> {
  const key = deliveredCountKey(userId);
  const cached = await getCache<number>(key);
  if (cached !== null && cached !== undefined) return cached;

  const count = await Order.countDocuments({ user: userId, status: 'delivered' })
    .maxTimeMS(COUPON_QUERY_MAX_MS);

  await setCache(key, count, DELIVERED_TTL);
  return count;
}

export async function invalidateUserDeliveredOrderCount(userId: string): Promise<void> {
  await deleteCache(deliveredCountKey(userId));
}

/**
 * Call when an order transitions to `delivered` so coupon eligibility caches stay accurate.
 */
export async function onOrderMarkedDelivered(userId: string): Promise<void> {
  const key = deliveredCountKey(userId);
  if (redisEnabled) {
    const cached = await redisConnection.get(key);
    if (cached !== null) {
      await redisConnection.incr(key);
      await redisConnection.expire(key, DELIVERED_TTL);
      return;
    }
  }
  await invalidateUserDeliveredOrderCount(userId);
}
