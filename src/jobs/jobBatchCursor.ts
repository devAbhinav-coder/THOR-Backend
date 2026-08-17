import { redisConnection, redisEnabled } from "../config/redis";
import logger from "../types/utils/logger";

const memoryCursors = new Map<string, string>();

function cursorKey(jobName: string): string {
  return `jobs:cursor:${jobName}`;
}

/** Last processed document _id for round-robin batch jobs. */
export async function getJobBatchCursor(jobName: string): Promise<string | null> {
  if (redisEnabled) {
    try {
      const raw = await redisConnection.get(cursorKey(jobName));
      return raw || null;
    } catch (err: unknown) {
      logger.warn({
        msg: "job_cursor_read_failed",
        job: jobName,
        error: (err as Error).message,
      });
    }
  }
  return memoryCursors.get(jobName) ?? null;
}

export async function setJobBatchCursor(
  jobName: string,
  lastId: string,
): Promise<void> {
  if (redisEnabled) {
    try {
      await redisConnection.set(cursorKey(jobName), lastId, "EX", 86400 * 7);
    } catch (err: unknown) {
      logger.warn({
        msg: "job_cursor_write_failed",
        job: jobName,
        error: (err as Error).message,
      });
    }
  }
  memoryCursors.set(jobName, lastId);
}

export async function clearJobBatchCursor(jobName: string): Promise<void> {
  if (redisEnabled) {
    try {
      await redisConnection.del(cursorKey(jobName));
    } catch {
      /* ignore */
    }
  }
  memoryCursors.delete(jobName);
}

/**
 * Advance cursor after a batch. If batch is full, store last id; else reset to start.
 */
export async function advanceJobBatchCursor(
  jobName: string,
  batch: unknown[],
  batchSize: number,
  idSelector: (row: unknown) => string,
): Promise<void> {
  if (batch.length >= batchSize) {
    const last = batch[batch.length - 1];
    await setJobBatchCursor(jobName, idSelector(last));
  } else {
    await clearJobBatchCursor(jobName);
  }
}
