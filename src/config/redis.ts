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
  retryStrategy: (times: number) => {
    if (times > 8) return null;
    return Math.min(times * 250, 2000);
  },
  reconnectOnError: (err: Error) => {
    const msg = err.message || '';
    if (msg.includes('max number of clients') || msg.includes('ECONNRESET')) {
      return false;
    }
    return true;
  },
};

type RedisLike = Pick<
  IORedis,
  'call' | 'get' | 'set' | 'del' | 'incr' | 'expire' | 'ping' | 'quit' | 'on' | 'keys'
>;

const memoryStore = new Map<string, string>();
const memoryExpiry = new Map<string, number>();
const memoryCounters = new Map<string, number>();

/** In-memory KEYS fallback: only `*` is treated as a glob segment; other regex metacharacters are escaped. */
function redisGlobPatternToRegExp(pattern: string): RegExp {
  const escapeRe = (s: string) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
  const body = pattern.split('*').map(escapeRe).join('.*');
  return new RegExp(`^${body}$`);
}

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
  keys: async (pattern: string) => {
    const regex = redisGlobPatternToRegExp(pattern);
    const matched: string[] = [];
    for (const key of memoryStore.keys()) {
      if (!isExpired(key) && regex.test(key)) {
        matched.push(key);
      }
    }
    return matched;
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

function createRedisClient(): IORedis {
  return redisUrl ?
      new IORedis(redisUrl, commonOptions)
    : new IORedis({
        host: process.env.REDIS_HOST as string,
        port: Number(process.env.REDIS_PORT || 6379),
        password: process.env.REDIS_PASSWORD || undefined,
        ...commonOptions,
      });
}

export const redisConnection: RedisLike = redisEnabled ? createRedisClient() : fallbackRedis;

/** Shared BullMQ queue connection (one per process — was leaking ~8 duplicates before). */
let bullMqQueueConnection: IORedis | null = null;
/** Shared BullMQ worker connection (blocking commands; separate from queue). */
let bullMqWorkerConnection: IORedis | null = null;

function attachRedisErrorLogger(client: IORedis, label: string): void {
  let lastWarnTs = 0;
  client.on('error', (err: Error) => {
    const now = Date.now();
    if (now - lastWarnTs > 15000) {
      lastWarnTs = now;
      logger.warn(`Redis (${label}): ${err.message || 'connection error'}`);
    }
  });
}

if (isProd && !redisEnabled) {
  throw new Error('Redis is required in production for queue/locks/rate-limits. Configure REDIS_URL.');
}

if (redisEnabled && redisConnection instanceof IORedis) {
  redisConnection.on('connect', () => logger.info('Redis connected'));
  attachRedisErrorLogger(redisConnection, 'app');
} else if (!redisEnabled) {
  logger.warn('Redis not configured. Running with in-memory fallbacks for cache/locks/limits.');
}

/**
 * @deprecated Prefer getBullMqQueueConnection / getBullMqWorkerConnection.
 */
export function duplicateRedisForBullMq(): IORedis {
  return getBullMqQueueConnection();
}

export function getBullMqQueueConnection(): IORedis {
  if (!redisEnabled) {
    throw new Error('getBullMqQueueConnection: Redis is not configured');
  }
  if (!(redisConnection instanceof IORedis)) {
    throw new Error('getBullMqQueueConnection: in-memory Redis cannot run BullMQ');
  }
  if (!bullMqQueueConnection) {
    bullMqQueueConnection = redisConnection.duplicate();
    attachRedisErrorLogger(bullMqQueueConnection, 'bullmq-queue');
  }
  return bullMqQueueConnection;
}

export function getBullMqWorkerConnection(): IORedis {
  if (!redisEnabled) {
    throw new Error('getBullMqWorkerConnection: Redis is not configured');
  }
  if (!(redisConnection instanceof IORedis)) {
    throw new Error('getBullMqWorkerConnection: in-memory Redis cannot run BullMQ');
  }
  if (!bullMqWorkerConnection) {
    bullMqWorkerConnection = redisConnection.duplicate();
    attachRedisErrorLogger(bullMqWorkerConnection, 'bullmq-worker');
  }
  return bullMqWorkerConnection;
}

/** Close app + BullMQ Redis connections (call on graceful shutdown / before hot reload). */
export async function closeAllRedisConnections(): Promise<void> {
  const closes: Promise<unknown>[] = [];
  if (bullMqQueueConnection) {
    closes.push(bullMqQueueConnection.quit().catch(() => {}));
    bullMqQueueConnection = null;
  }
  if (bullMqWorkerConnection) {
    closes.push(bullMqWorkerConnection.quit().catch(() => {}));
    bullMqWorkerConnection = null;
  }
  if (redisConnection instanceof IORedis) {
    closes.push(redisConnection.quit().catch(() => {}));
  }
  await Promise.all(closes);
}

/**
 * BullMQ runs INFO and warns if maxmemory-policy is not noeviction. In development, managed
 * Redis often uses volatile-lru — skip those checks by default. In production, checks stay on
 * unless BULLMQ_SKIP_REDIS_VERSION_CHECK=true (not recommended).
 */
export function bullmqSkipRedisVersionChecks(): boolean {
  if (process.env.NODE_ENV === 'production') {
    return process.env.BULLMQ_SKIP_REDIS_VERSION_CHECK === 'true';
  }
  return process.env.BULLMQ_SKIP_REDIS_VERSION_CHECK !== 'false';
}
