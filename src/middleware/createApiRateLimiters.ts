import rateLimit, { RateLimitRequestHandler } from "express-rate-limit";
import { RedisStore } from "rate-limit-redis";
import { redisConnection, shouldUseRedisRateLimit } from "../config/redis";
import { resolveApiRateLimitMax } from "../config/rateLimitPolicy";
import logger from "../types/utils/logger";

export type ApiRateLimiters = {
  limiter: RateLimitRequestHandler;
  authLimiter: RateLimitRequestHandler;
  effectiveMax: number;
  authEffectiveMax: number;
  redisStore: boolean;
};

function redisStore(prefix: string) {
  return new RedisStore({
    prefix,
    sendCommand: (...args: string[]) =>
      redisConnection.call(
        args[0],
        ...(args.slice(1) as string[]),
      ) as Promise<string | number | boolean | (string | number | boolean)[]>,
  });
}

/** Call only after `bootstrapRedis()` so Redis store + prod max are correct. */
export function createApiRateLimiters(
  configuredProdMax: number,
  windowMs: number,
): ApiRateLimiters {
  const effectiveMax = resolveApiRateLimitMax(configuredProdMax);
  const authEffectiveMax = resolveApiRateLimitMax(50);
  const useRedisStore = shouldUseRedisRateLimit();

  const limiter = rateLimit({
    windowMs,
    max: effectiveMax,
    skip: (req) => req.method === "OPTIONS",
    message: {
      status: "error",
      message: "Too many requests, please try again later.",
    },
    standardHeaders: true,
    legacyHeaders: false,
    ...(useRedisStore ? { store: redisStore("rl:api:") } : {}),
  });

  const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: authEffectiveMax,
    skip: (req) => req.method === "OPTIONS",
    message: {
      status: "error",
      message:
        "Too many authentication attempts, please try again after 15 minutes.",
    },
    standardHeaders: true,
    legacyHeaders: false,
    ...(useRedisStore ? { store: redisStore("rl:auth:") } : {}),
  });

  logger.info(
    `API rate limits ready: max=${effectiveMax} authMax=${authEffectiveMax} windowMs=${windowMs} redisStore=${useRedisStore}`,
  );

  return {
    limiter,
    authLimiter,
    effectiveMax,
    authEffectiveMax,
    redisStore: useRedisStore,
  };
}
