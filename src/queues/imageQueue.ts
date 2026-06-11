import { Queue, Worker, JobsOptions, ConnectionOptions } from "bullmq";
import { deleteMultipleImages } from "../services/cloudinary";
import {
  bullmqSkipRedisVersionChecks,
  getBullMqQueueConnection,
  getBullMqWorkerConnection,
  redisEnabled,
} from "../config/redis";
import logger from "../types/utils/logger";

// ─── Job Types ────────────────────────────────────────────────────────────────

export type ImageDeleteJobData = {
  publicIds: string[];
};

// ─── Queue Setup ──────────────────────────────────────────────────────────────

const IMAGE_QUEUE_NAME = "image-delete-jobs";
const skipBullMqRedisChecks = bullmqSkipRedisVersionChecks();
const imageQueueRedis = redisEnabled ? getBullMqQueueConnection() : null;

export const imageQueue =
  imageQueueRedis ?
    new Queue<ImageDeleteJobData>(IMAGE_QUEUE_NAME, {
      connection: imageQueueRedis as unknown as ConnectionOptions,
      skipVersionCheck: skipBullMqRedisChecks,
    })
  : null;

const defaultOpts: JobsOptions = {
  attempts: 3,
  backoff: { type: "exponential", delay: 5000 },
  removeOnComplete: 100,
  removeOnFail: 200,
};

// ─── Enqueue helper ───────────────────────────────────────────────────────────

/**
 * Enqueue a Cloudinary multi-image delete job.
 * If BullMQ/Redis is unavailable, falls back to immediate (fire-and-forget) deletion.
 */
export async function enqueueImageDelete(publicIds: string[]): Promise<void> {
  if (!publicIds.length) return;
  try {
    if (!imageQueue) {
      // Redis unavailable — delete in background without blocking the request
      deleteMultipleImages(publicIds).catch((err) =>
        logger.error(
          `Inline Cloudinary delete failed: ${(err as Error).message}`,
        ),
      );
      return;
    }
    await imageQueue.add("image-delete", { publicIds }, defaultOpts);
  } catch (err) {
    // Queue unavailable — fall back to background deletion
    logger.warn(
      `Image queue unavailable, falling back to inline delete: ${(err as Error).message}`,
    );
    deleteMultipleImages(publicIds).catch((e) =>
      logger.error(
        `Fallback Cloudinary delete failed: ${(e as Error).message}`,
      ),
    );
  }
}

// ─── Worker ───────────────────────────────────────────────────────────────────

let imageWorker: Worker<ImageDeleteJobData> | null = null;

export const startImageWorker = (): void => {
  if (imageWorker || !redisEnabled) return;

  const workerRedis = getBullMqWorkerConnection();
  imageWorker = new Worker<ImageDeleteJobData>(
    IMAGE_QUEUE_NAME,
    async (job) => {
      const { publicIds } = job.data;
      if (publicIds.length > 0) {
        await deleteMultipleImages(publicIds);
      }
    },
    {
      connection: workerRedis as unknown as ConnectionOptions,
      skipVersionCheck: skipBullMqRedisChecks,
      concurrency: 2,
    },
  );

  imageWorker.on("completed", (job) =>
    logger.info(
      `Image delete job completed: ${job.id} (${job.data.publicIds.length} images)`,
    ),
  );
  imageWorker.on("failed", (job, err) =>
    logger.error(`Image delete job failed (${job?.id}): ${err.message}`),
  );
};

export const closeImageWorker = async (): Promise<void> => {
  if (imageWorker) {
    await imageWorker.close();
    imageWorker = null;
  }
};
