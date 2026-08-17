import { Queue, Worker, JobsOptions, ConnectionOptions } from "bullmq";
import {
  bullmqSkipRedisVersionChecks,
  getBullMqQueueConnection,
  getBullMqWorkerConnection,
  isRedisOperational,
} from "../config/redis";
import { bullmqMaintenanceRetention } from "../config/bullmqRetention";
import logger from "../types/utils/logger";
import { runWithJobHealth } from "../jobs/jobHealthService";
import { getMaintenanceJobRunner } from "../jobs/maintenanceJobRunners";

export type MaintenanceJobPayload = {
  jobName: string;
};

const queueName = "maintenance-jobs";
const skipBullMqRedisChecks = bullmqSkipRedisVersionChecks();
const maintenanceQueueRedis = isRedisOperational() ? getBullMqQueueConnection() : null;

export const maintenanceQueue =
  maintenanceQueueRedis ?
    new Queue<MaintenanceJobPayload>(queueName, {
      connection: maintenanceQueueRedis as unknown as ConnectionOptions,
      skipVersionCheck: skipBullMqRedisChecks,
    })
  : null;

const defaultOpts: JobsOptions = {
  attempts: 2,
  backoff: { type: "exponential", delay: 5000 },
  removeOnComplete: bullmqMaintenanceRetention.removeOnComplete,
  removeOnFail: bullmqMaintenanceRetention.removeOnFail,
};

/** Heavy schedulers enqueue here; worker runs the registered runner. */
export function shouldUseMaintenanceQueue(): boolean {
  if (process.env.MAINTENANCE_JOBS_INLINE === "true") return false;
  return isRedisOperational();
}

export async function enqueueMaintenanceJob(jobName: string): Promise<void> {
  const runner = getMaintenanceJobRunner(jobName);
  if (!runner) {
    logger.warn({ msg: "maintenance_job_unknown", jobName });
    return;
  }

  if (!maintenanceQueue) {
    await runWithJobHealth(jobName, async () => {
      const result = await runner();
      if (typeof result === "number" && result > 0) {
        logger.info({ msg: `${jobName}_completed`, count: result });
      } else if (result && typeof result === "object") {
        logger.info({ msg: `${jobName}_completed`, ...result });
      }
      return typeof result === "number" ? result : 0;
    });
    return;
  }

  try {
    await maintenanceQueue.add(
      "run",
      { jobName },
      {
        ...defaultOpts,
        jobId: `maint__${jobName}`,
      },
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "enqueue failed";
    if (message.includes("Job") && message.includes("exists")) {
      logger.info({ msg: "maintenance_job_deduplicated", jobName });
      return;
    }
    logger.error({ msg: "maintenance_job_enqueue_failed", jobName, error: message });
    throw err instanceof Error ? err : new Error(message);
  }
}

let workerStarted = false;
let maintenanceWorker: Worker<MaintenanceJobPayload> | null = null;

export function startMaintenanceWorker(): void {
  if (workerStarted || !isRedisOperational()) return;
  workerStarted = true;

  const workerRedis = getBullMqWorkerConnection();
  const concurrency = Number(process.env.MAINTENANCE_WORKER_CONCURRENCY || 1);

  maintenanceWorker = new Worker<MaintenanceJobPayload>(
    queueName,
    async (job) => {
      const { jobName } = job.data;
      const runner = getMaintenanceJobRunner(jobName);
      if (!runner) {
        throw new Error(`Unknown maintenance job: ${jobName}`);
      }

      await runWithJobHealth(jobName, async () => {
        const result = await runner();
        if (typeof result === "number" && result > 0) {
          logger.info({ msg: `${jobName}_completed`, count: result });
        } else if (result && typeof result === "object") {
          logger.info({ msg: `${jobName}_completed`, ...result });
        }
        return typeof result === "number" ? result : 0;
      });
    },
    {
      connection: workerRedis as unknown as ConnectionOptions,
      skipVersionCheck: skipBullMqRedisChecks,
      concurrency,
    },
  );

  maintenanceWorker.on("failed", (job, err) => {
    logger.error(`Maintenance job failed (${job?.id}): ${err.message}`);
  });
}

export async function closeMaintenanceWorker(): Promise<void> {
  if (maintenanceWorker) {
    await maintenanceWorker.close();
    maintenanceWorker = null;
  }
  workerStarted = false;
}
