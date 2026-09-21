import {
  isRedisOperational,
  redisConnection,
  redisEnabled,
} from "./redis";

/**
 * When true, `/api/health` returns 503 if Redis was configured but is not operational
 * (runtime outage). Default: on in production, off in development unless explicitly enabled.
 */
export function isRedisStrictReadinessRequired(): boolean {
  if (process.env.NODE_ENV !== "production") {
    return process.env.REDIS_REQUIRED_STRICT === "true";
  }
  return process.env.REDIS_REQUIRED_STRICT !== "false";
}

export async function pingRedisForReadiness(): Promise<boolean> {
  if (!redisEnabled) {
    return process.env.NODE_ENV !== "production";
  }

  if (isRedisStrictReadinessRequired() && !isRedisOperational()) {
    return false;
  }

  try {
    const pong = await Promise.race([
      redisConnection.ping(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("Redis ping timeout")), 2500),
      ),
    ]);
    return pong === "PONG";
  } catch {
    return false;
  }
}

export function isRedisRequiredForProduction(): boolean {
  return process.env.NODE_ENV === "production" && redisEnabled;
}
