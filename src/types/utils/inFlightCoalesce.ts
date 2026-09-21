import { recordPlatformMetric } from "../../services/observability/platformMetricsService";

const inFlight = new Map<string, Promise<unknown>>();

/**
 * Process-local request coalescing: parallel callers with the same key share one promise.
 */
export function coalesceInFlight<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const existing = inFlight.get(key) as Promise<T> | undefined;
  if (existing) {
    recordPlatformMetric("cache.fetch.coalesced", { key: key.slice(0, 80) });
    return existing;
  }

  const promise = fn().finally(() => {
    if (inFlight.get(key) === promise) {
      inFlight.delete(key);
    }
  });

  inFlight.set(key, promise);
  return promise;
}

/** Test-only: reset in-flight map between cases. */
export function resetInFlightCoalesceForTests(): void {
  inFlight.clear();
}
