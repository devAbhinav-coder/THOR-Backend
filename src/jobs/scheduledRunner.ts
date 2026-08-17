import cron, { ScheduledTask } from "node-cron";
import logger from "../types/utils/logger";

const DEFAULT_JITTER_MS = Number(process.env.JOB_STARTUP_JITTER_MS || 5000);

export type ScheduledJobOptions = {
  name: string;
  /** When false, job is not started. Default true. */
  enabled?: boolean;
  /** Fixed interval in ms. Ignored when cronExpression is set. */
  intervalMs?: number;
  /** Cron expression (e.g. "0 2 * * *" for 2 AM daily). Takes precedence over intervalMs. */
  cronExpression?: string;
  /** Delay before the first tick (ms). Default 0. */
  initialDelayMs?: number;
  /** Random 0–jitterMs delay before each tick to avoid thundering herd. Default JOB_STARTUP_JITTER_MS. */
  jitterMs?: number;
  onTick: () => Promise<void>;
  onError?: (err: unknown) => void;
};

type RunningJob = {
  stop: () => void;
};

const runningJobs = new Map<string, RunningJob>();

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function randomJitter(maxMs: number): number {
  if (maxMs <= 0) return 0;
  return Math.floor(Math.random() * maxMs);
}

/**
 * Start a background job on either a cron schedule or fixed interval.
 * Applies startup jitter before each tick when jitterMs > 0.
 */
export function startScheduledJob(options: ScheduledJobOptions): () => void {
  const {
    name,
    enabled = true,
    intervalMs,
    cronExpression,
    initialDelayMs = 0,
    jitterMs = DEFAULT_JITTER_MS,
    onTick,
    onError,
  } = options;

  if (!enabled) {
    logger.info({ msg: "scheduled_job_disabled", job: name });
    return () => {};
  }

  if (runningJobs.has(name)) {
    return () => runningJobs.get(name)?.stop();
  }

  let intervalTimer: ReturnType<typeof setInterval> | null = null;
  let cronTask: ScheduledTask | null = null;
  let stopped = false;

  const runTick = async () => {
    if (stopped) return;
    const delay = randomJitter(jitterMs);
    if (delay > 0) {
      await sleep(delay);
    }
    if (stopped) return;
    try {
      await onTick();
    } catch (err: unknown) {
      if (onError) {
        onError(err);
      } else {
        const message = err instanceof Error ? err.message : "job tick failed";
        logger.error({ msg: "scheduled_job_error", job: name, error: message });
      }
    }
  };

  const startLoop = () => {
    if (cronExpression) {
      if (!cron.validate(cronExpression)) {
        logger.error({
          msg: "scheduled_job_invalid_cron",
          job: name,
          cronExpression,
        });
        return;
      }
      cronTask = cron.schedule(cronExpression, () => void runTick(), {
        timezone: process.env.JOB_CRON_TIMEZONE || "Asia/Kolkata",
      });
      logger.info({
        msg: "scheduled_job_started",
        job: name,
        schedule: "cron",
        cronExpression,
      });
    } else if (intervalMs && intervalMs > 0) {
      void runTick();
      intervalTimer = setInterval(() => void runTick(), intervalMs);
      logger.info({
        msg: "scheduled_job_started",
        job: name,
        schedule: "interval",
        intervalMs,
        jitterMs,
      });
    } else {
      logger.warn({ msg: "scheduled_job_no_schedule", job: name });
    }
  };

  if (initialDelayMs > 0) {
    setTimeout(startLoop, initialDelayMs).unref?.();
  } else {
    startLoop();
  }

  const stop = () => {
    stopped = true;
    if (intervalTimer) {
      clearInterval(intervalTimer);
      intervalTimer = null;
    }
    if (cronTask) {
      cronTask.stop();
      cronTask = null;
    }
    runningJobs.delete(name);
  };

  runningJobs.set(name, { stop });
  return stop;
}

export function stopScheduledJob(name: string): void {
  runningJobs.get(name)?.stop();
}

export function stopAllScheduledJobs(): void {
  for (const job of runningJobs.values()) {
    job.stop();
  }
}
