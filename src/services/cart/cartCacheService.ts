import { getCache, setCache, deleteCache } from '../cacheService';
import {
  CART_CACHE_KEY_PREFIX,
  CART_CACHE_TTL_SEC,
} from './cartConstants';
import type { CartDto } from './cartDto';

export function cartCacheKey(userId: string, version?: number): string {
  if (version !== undefined) {
    return `${CART_CACHE_KEY_PREFIX}${userId}:v${version}`;
  }
  return `${CART_CACHE_KEY_PREFIX}${userId}`;
}

export const cartCacheService = {
  async get(userId: string): Promise<CartDto | null> {
    return getCache<CartDto>(cartCacheKey(userId));
  },

  async set(userId: string, dto: CartDto, version?: number): Promise<void> {
    const key = cartCacheKey(userId, version ?? dto.version);
    await setCache(key, dto, CART_CACHE_TTL_SEC);
    // Also store latest pointer for versioned invalidation
    await setCache(cartCacheKey(userId), dto, CART_CACHE_TTL_SEC);
  },

  async invalidate(userId: string): Promise<void> {
    await deleteCache(cartCacheKey(userId));
  },
};
