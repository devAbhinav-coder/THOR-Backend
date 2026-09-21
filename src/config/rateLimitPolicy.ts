import { shouldUseRedisRateLimit } from "./redis";

/** Effective API rate limit max - lower per pod when Redis store is unavailable. */
export function resolveApiRateLimitMax(configuredMax: number): number {
  if (
    process.env.NODE_ENV !== "production" &&
    process.env.LOAD_TEST_RELAX_RATE_LIMIT === "true"
  ) {
    return configuredMax;
  }

  if (shouldUseRedisRateLimit()) {
    return configuredMax;
  }

  const failClosed =
    process.env.RATE_LIMIT_FAIL_CLOSED_WITHOUT_REDIS === "true";
  if (failClosed) {
    return 0;
  }

  const memoryCap = parseInt(process.env.RATE_LIMIT_MEMORY_MAX || "50", 10);
  return Math.min(configuredMax, Math.max(10, memoryCap));
}
