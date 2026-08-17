import { redisConnection, redisEnabled } from "../config/redis";
import logger from "../types/utils/logger";

export type JobHealthEntry = {
  lastRunAt: string;
  lastSuccessAt?: string;
  lastError?: string;
  lastDurationMs: number;
  lastCount?: number;
  runCount: number;
  errorCount: number;
};

const memoryHealth = new Map<string, JobHealthEntry>();

function healthKey(name: string): string {
  return `jobs:health:${name}`;
}

export async function recordJobRun(
  name: string,
  result: {
    success: boolean;
    durationMs: number;
    count?: number;
    error?: string;
  },
): Promise<void> {
  const existing = await getJobHealth(name);
  const entry: JobHealthEntry = {
    lastRunAt: new Date().toISOString(),
    lastSuccessAt:
      result.success ?
        new Date().toISOString()
      : existing?.lastSuccessAt,
    lastError: result.success ? undefined : result.error,
    lastDurationMs: result.durationMs,
    lastCount: result.count,
    runCount: (existing?.runCount ?? 0) + 1,
    errorCount: (existing?.errorCount ?? 0) + (result.success ? 0 : 1),
  };

  if (redisEnabled) {
    try {
      await redisConnection.set(
        healthKey(name),
        JSON.stringify(entry),
        "EX",
        86400 * 14,
      );
      await redisConnection.incr(`jobs:metrics:${name}:runs`);
      if (!result.success) {
        await redisConnection.incr(`jobs:metrics:${name}:errors`);
      }
    } catch (err: unknown) {
      logger.warn({
        msg: "job_health_record_failed",
        job: name,
        error: (err as Error).message,
      });
    }
  }
  memoryHealth.set(name, entry);
}

export async function getJobHealth(
  name: string,
): Promise<JobHealthEntry | null> {
  if (redisEnabled) {
    try {
      const raw = await redisConnection.get(healthKey(name));
      if (raw) return JSON.parse(raw) as JobHealthEntry;
    } catch {
      /* fall through */
    }
  }
  return memoryHealth.get(name) ?? null;
}

export async function getAllJobHealth(): Promise<Record<string, JobHealthEntry>> {
  const out: Record<string, JobHealthEntry> = {
    ...Object.fromEntries(memoryHealth),
  };

  if (redisEnabled) {
    try {
      const keys = await redisConnection.keys("jobs:health:*");
      for (const key of keys) {
        const raw = await redisConnection.get(key);
        if (!raw) continue;
        const name = key.replace("jobs:health:", "");
        try {
          out[name] = JSON.parse(raw) as JobHealthEntry;
        } catch {
          /* skip corrupt */
        }
      }
    } catch (err: unknown) {
      logger.warn({
        msg: "job_health_read_failed",
        error: (err as Error).message,
      });
    }
  }
  return out;
}

export async function runWithJobHealth<T>(
  name: string,
  fn: () => Promise<T>,
): Promise<T> {
  const started = Date.now();
  try {
    const result = await fn();
    const count = typeof result === "number" ? result : undefined;
    await recordJobRun(name, {
      success: true,
      durationMs: Date.now() - started,
      count,
    });
    return result;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "job failed";
    await recordJobRun(name, {
      success: false,
      durationMs: Date.now() - started,
      error: message,
    });
    throw err;
  }
}
