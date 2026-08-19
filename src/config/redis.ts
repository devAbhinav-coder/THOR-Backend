import IORedis, { RedisOptions } from "ioredis";
import logger from "../types/utils/logger";

const redisUrl = process.env.REDIS_URL;
const hasHostConfig = Boolean(process.env.REDIS_HOST || process.env.REDIS_PORT);
const configuredRedis = Boolean(redisUrl || hasHostConfig);
const isProd = process.env.NODE_ENV === "production";

/** False only when Redis is configured but startup probe fails — then memory fallbacks apply. */
let redisOperational = configuredRedis;

export function isRedisOperational(): boolean {
  return redisOperational;
}

/** Redis-backed rate limits whenever Redis is up (dev + prod). */
export function shouldUseRedisRateLimit(): boolean {
  return isRedisOperational();
}

const commonOptions: RedisOptions = {
  maxRetriesPerRequest: isProd ? (null as null) : 3,
  enableReadyCheck: isProd,
  lazyConnect: true,
  connectTimeout: 5000,
  retryStrategy: (times: number) => {
    if (times > 8) return null;
    return Math.min(times * 250, 2000);
  },
  reconnectOnError: (err: Error) => {
    const msg = err.message || "";
    if (msg.includes("max number of clients") || msg.includes("ECONNRESET")) {
      return false;
    }
    return true;
  },
};

type RedisLike = Pick<
  IORedis,
  | "call"
  | "get"
  | "set"
  | "del"
  | "incr"
  | "expire"
  | "ping"
  | "quit"
  | "on"
  | "keys"
  | "connect"
  | "disconnect"
  | "status"
>;

const memoryStore = new Map<string, string>();
const memoryExpiry = new Map<string, number>();
const memoryCounters = new Map<string, number>();

function redisGlobPatternToRegExp(pattern: string): RegExp {
  const escapeRe = (s: string) => s.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
  const body = pattern.split("*").map(escapeRe).join(".*");
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
    const hasNx = args.includes("NX");
    if (hasNx && memoryStore.has(key) && !isExpired(key)) {
      return null;
    }
    const exIndex = args.findIndex((a) => a === "EX");
    if (exIndex >= 0 && typeof args[exIndex + 1] === "number") {
      memoryExpiry.set(key, Date.now() + Number(args[exIndex + 1]) * 1000);
    }
    memoryStore.set(key, value);
    return "OK";
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
  ping: async () => "PONG",
  quit: async () => "OK",
  connect: async () => undefined,
  disconnect: () => undefined,
  status: "ready",
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

const realRedisClient: IORedis | null = configuredRedis ? createRedisClient() : null;

function activeConnection(): RedisLike {
  if (redisOperational && realRedisClient) return realRedisClient;
  return fallbackRedis;
}

/** App Redis — falls back to in-memory only if startup probe fails. */
export const redisConnection: RedisLike = new Proxy({} as RedisLike, {
  get(_target, prop: keyof RedisLike) {
    const conn = activeConnection();
    const value = conn[prop];
    return typeof value === "function" ? value.bind(conn) : value;
  },
});

/** @deprecated Prefer isRedisOperational() — true when REDIS_URL/REDIS_HOST is set. */
export const redisEnabled = configuredRedis;

let bullMqQueueConnection: IORedis | null = null;
let bullMqWorkerConnection: IORedis | null = null;

function attachRedisErrorLogger(client: IORedis, label: string): void {
  let lastWarnTs = 0;
  client.on("error", (err: Error) => {
    const now = Date.now();
    if (now - lastWarnTs > 15000) {
      lastWarnTs = now;
      logger.warn(`Redis (${label}): ${err.message || "connection error"}`);
    }
  });
}

if (isProd && !configuredRedis) {
  throw new Error(
    "Redis is required in production for queue/locks/rate-limits. Configure REDIS_URL.",
  );
}

if (realRedisClient) {
  realRedisClient.on("connect", () => logger.info("Redis connected"));
  attachRedisErrorLogger(realRedisClient, "app");
} else if (!configuredRedis) {
  logger.warn(
    "Redis not configured. Running with in-memory fallbacks for cache/locks/limits.",
  );
}

/** Connect + ping at startup; memory fallback only if Redis is down. Safe to call again after outage. */
export async function bootstrapRedis(): Promise<void> {
  if (!realRedisClient) return;

  try {
    const status = realRedisClient.status;
    if (status === "wait" || status === "end" || status === "close") {
      await realRedisClient.connect();
    } else if (status === "connecting") {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error("Redis connect timeout")),
          5000,
        );
        realRedisClient!.once("ready", () => {
          clearTimeout(timer);
          resolve();
        });
        realRedisClient!.once("error", (e: Error) => {
          clearTimeout(timer);
          reject(e);
        });
      });
    }

    const pong = await Promise.race([
      realRedisClient.ping(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("Redis ping timeout")), 3000),
      ),
    ]);
    if (pong !== "PONG") throw new Error("Redis ping failed");
    if (!redisOperational) {
      logger.info("Redis reconnected");
    } else {
      logger.info("Redis ready");
    }
    redisOperational = true;
  } catch (err: unknown) {
    redisOperational = false;
    logger.warn(
      `Redis unavailable (${(err as Error).message}). Using in-memory fallbacks — ` +
        "start Redis: npm run redis:up (or REDIS_URL=redis://127.0.0.1:6379).",
    );
  }
}

/** Lightweight reconnect probe for health checks and worker heartbeats. */
export async function reconnectRedisIfNeeded(): Promise<boolean> {
  if (!realRedisClient) return false;
  if (isRedisOperational()) {
    try {
      const pong = await redisConnection.ping();
      return pong === "PONG";
    } catch {
      redisOperational = false;
    }
  }
  await bootstrapRedis();
  return isRedisOperational();
}

export function getRedisClient(): IORedis | null {
  return redisOperational && realRedisClient ? realRedisClient : null;
}

export function duplicateRedisForBullMq(): IORedis {
  return getBullMqQueueConnection();
}

export function getBullMqQueueConnection(): IORedis {
  if (!isRedisOperational() || !realRedisClient) {
    throw new Error("getBullMqQueueConnection: Redis is not configured");
  }
  if (!bullMqQueueConnection) {
    bullMqQueueConnection = realRedisClient.duplicate({
      maxRetriesPerRequest: null,
    });
    attachRedisErrorLogger(bullMqQueueConnection, "bullmq-queue");
  }
  return bullMqQueueConnection;
}

export function getBullMqWorkerConnection(): IORedis {
  if (!isRedisOperational() || !realRedisClient) {
    throw new Error("getBullMqWorkerConnection: Redis is not configured");
  }
  if (!bullMqWorkerConnection) {
    bullMqWorkerConnection = realRedisClient.duplicate({
      maxRetriesPerRequest: null,
    });
    attachRedisErrorLogger(bullMqWorkerConnection, "bullmq-worker");
  }
  return bullMqWorkerConnection;
}

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
  if (realRedisClient) {
    closes.push(realRedisClient.quit().catch(() => {}));
  }
  await Promise.all(closes);
}

export function bullmqSkipRedisVersionChecks(): boolean {
  if (process.env.NODE_ENV === "production") {
    return process.env.BULLMQ_SKIP_REDIS_VERSION_CHECK === "true";
  }
  return process.env.BULLMQ_SKIP_REDIS_VERSION_CHECK !== "false";
}
