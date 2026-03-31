import IORedis, { RedisOptions } from 'ioredis';
import logger from '../utils/logger';

const redisUrl = process.env.REDIS_URL;
const hasHostConfig = Boolean(process.env.REDIS_HOST || process.env.REDIS_PORT);
export const redisEnabled = Boolean(redisUrl || hasHostConfig);
const isProd = process.env.NODE_ENV === 'production';

const commonOptions: RedisOptions = {
  maxRetriesPerRequest: null as null,
  enableReadyCheck: true,
  lazyConnect: true,
  connectTimeout: 3000,
  retryStrategy: (times: number) => Math.min(times * 250, 2000),
};

type RedisLike = Pick<
  IORedis,
  'call' | 'get' | 'set' | 'del' | 'incr' | 'expire' | 'ping' | 'quit' | 'on'
>;

const memoryStore = new Map<string, string>();
const memoryExpiry = new Map<string, number>();
const memoryCounters = new Map<string, number>();

const isExpired = (key: string): boolean => {
  const exp = memoryExpiry.get(key);
  if (!exp) return false;
  if (Date.now() > exp) {
    memoryExpiry.delete(key);
    memoryStore.delete(key);
    memoryCounters.delete(key);
    return true;
  }
  return false;
};

const fallbackRedis: RedisLike = {
  on: () => fallbackRedis as unknown as IORedis,
  call: async () => null,
  get: async (key: string) => {
    if (isExpired(key)) return null;
    return memoryStore.get(key) ?? null;
  },
  set: async (key: string, value: string, ...args: unknown[]) => {
    const hasNx = args.includes('NX');
    if (hasNx && memoryStore.has(key) && !isExpired(key)) {
      return null;
    }
    const exIndex = args.findIndex((a) => a === 'EX');
    if (exIndex >= 0 && typeof args[exIndex + 1] === 'number') {
      memoryExpiry.set(key, Date.now() + Number(args[exIndex + 1]) * 1000);
    }
    memoryStore.set(key, value);
    return 'OK';
  },
  del: async (...keys: string[]) => {
    let count = 0;
    keys.forEach((k) => {
      count += memoryStore.delete(k) ? 1 : 0;
      memoryCounters.delete(k);
      memoryExpiry.delete(k);
    });
    return count;
  },
  incr: async (key: string) => {
    if (isExpired(key)) memoryCounters.delete(key);
    const next = (memoryCounters.get(key) ?? 0) + 1;
    memoryCounters.set(key, next);
    memoryStore.set(key, String(next));
    return next;
  },
  expire: async (key: string, sec: number) => {
    memoryExpiry.set(key, Date.now() + sec * 1000);
    return 1;
  },
  ping: async () => 'PONG',
  quit: async () => 'OK',
} as unknown as RedisLike;

export const redisConnection: RedisLike = redisEnabled
  ? (redisUrl
      ? new IORedis(redisUrl, commonOptions)
      : new IORedis({
          host: process.env.REDIS_HOST as string,
          port: Number(process.env.REDIS_PORT || 6379),
          password: process.env.REDIS_PASSWORD || undefined,
          ...commonOptions,
        }))
  : fallbackRedis;

if (isProd && !redisEnabled) {
  throw new Error('Redis is required in production for queue/locks/rate-limits. Configure REDIS_URL.');
}

if (redisEnabled) {
  let lastWarnTs = 0;
  redisConnection.on('connect', () => logger.info('Redis connected'));
  redisConnection.on('error', (err: Error) => {
    const now = Date.now();
    if (now - lastWarnTs > 15000) {
      lastWarnTs = now;
      logger.warn(`Redis unavailable: ${err.message || 'connection failed'}`);
    }
  });
} else {
  logger.warn('Redis not configured. Running with in-memory fallbacks for cache/locks/limits.');
}

