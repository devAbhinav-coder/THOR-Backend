import { getCache, setCache } from '../cacheService';
import {
  CART_IDEMPOTENCY_KEY_PREFIX,
  CART_IDEMPOTENCY_TTL_SEC,
} from './cartConstants';
import type { CartDto } from './cartDto';
import { recordCartMetric } from './cartMetricsService';

export function cartIdempotencyCacheKey(userId: string, key: string): string {
  return `${CART_IDEMPOTENCY_KEY_PREFIX}${userId}:${key}`;
}

export async function getIdempotentCartResult(
  userId: string,
  idempotencyKey: string | undefined
): Promise<CartDto | null> {
  if (!idempotencyKey?.trim()) return null;
  const cacheKey = cartIdempotencyCacheKey(userId, idempotencyKey.trim());
  const cached = await getCache<{ cart: CartDto }>(cacheKey);
  if (cached?.cart) {
    recordCartMetric('cart.idempotency.replay', { userId });
    return cached.cart;
  }
  return null;
}

export function storeIdempotentCartResult(
  userId: string,
  idempotencyKey: string | undefined,
  cart: CartDto
): void {
  if (!idempotencyKey?.trim()) return;
  const cacheKey = cartIdempotencyCacheKey(userId, idempotencyKey.trim());
  setCache(cacheKey, { cart }, CART_IDEMPOTENCY_TTL_SEC).catch(() => {});
}

export function resolveIdempotencyKey(
  bodyKey?: string,
  headerKey?: string | string[]
): string | undefined {
  const fromHeader = Array.isArray(headerKey) ? headerKey[0] : headerKey;
  const raw = bodyKey?.trim() || fromHeader?.trim();
  return raw && raw.length >= 8 ? raw.slice(0, 128) : undefined;
}
