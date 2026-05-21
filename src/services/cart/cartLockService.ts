import crypto from 'crypto';
import { redisConnection, redisEnabled } from '../../config/redis';
import AppError from '../../utils/AppError';
import { CART_LOCK_KEY_PREFIX, CART_LOCK_TTL_SEC } from './cartConstants';

const LOCK_RETRY_MS = 40;
const LOCK_MAX_WAIT_MS = 2000;

/** Serialize cart mutations per user when Redis is unavailable (local dev). */
const memoryMutationChains = new Map<string, Promise<unknown>>();

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withInMemoryCartLock<T>(userId: string, fn: () => Promise<T>): Promise<T> {
  const prev = memoryMutationChains.get(userId) ?? Promise.resolve();
  const run = prev.catch(() => {}).then(() => fn());
  memoryMutationChains.set(userId, run);
  try {
    return await run;
  } finally {
    if (memoryMutationChains.get(userId) === run) {
      memoryMutationChains.delete(userId);
    }
  }
}

/**
 * Per-user cart mutation lock. Prevents concurrent add/update races that create duplicate line items.
 */
export async function withCartMutationLock<T>(
  userId: string,
  fn: () => Promise<T>
): Promise<T> {
  if (!redisEnabled) {
    return withInMemoryCartLock(userId, fn);
  }

  const lockKey = `${CART_LOCK_KEY_PREFIX}${userId}`;
  const token = crypto.randomUUID();
  const deadline = Date.now() + LOCK_MAX_WAIT_MS;

  while (Date.now() < deadline) {
    const acquired = await redisConnection.set(lockKey, token, 'EX', CART_LOCK_TTL_SEC, 'NX');
    if (acquired === 'OK' || acquired === true) {
      try {
        return await fn();
      } finally {
        const current = await redisConnection.get(lockKey);
        if (current === token) {
          await redisConnection.del(lockKey);
        }
      }
    }
    await sleep(LOCK_RETRY_MS);
  }

  throw new AppError('Cart is being updated. Please try again.', 409);
}
