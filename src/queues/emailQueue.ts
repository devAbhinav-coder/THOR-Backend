import { Queue, Worker, JobsOptions } from "bullmq";
import { redisConnection, redisEnabled } from "../config/redis";
import logger from "../utils/logger";
import { sendEmailNow } from "../services/emailService";
import { deliverBroadcastEmailWithRetries } from "../services/emailDeliveryService";
import { ConnectionOptions } from "bullmq";

export type EmailJobData = {
  to: string;
  subject: string;
  html: string;
  text?: string;
};

/** One job processes up to 10 addresses sequentially (no Promise.all). */
export type BroadcastChunkJobData = {
  recipients: string[];
  subject: string;
  html: string;
};

const transactionalQueueName = "email-jobs-transactional";
const broadcastChunkQueueName = "email-broadcast-chunks";
const BROADCAST_CHUNK_SIZE = 10;

export const emailQueue = redisEnabled
  ? new Queue<EmailJobData>(transactionalQueueName, {
      connection: redisConnection as unknown as ConnectionOptions,
    })
  : null;

export const broadcastChunkQueue = redisEnabled
  ? new Queue<BroadcastChunkJobData>(broadcastChunkQueueName, {
      connection: redisConnection as unknown as ConnectionOptions,
    })
  : null;

const defaultOpts: JobsOptions = {
  attempts: 4,
  backoff: { type: "exponential", delay: 3000 },
  removeOnComplete: 500,
  removeOnFail: 1000,
};

const broadcastChunkOpts: JobsOptions = {
  attempts: 2,
  backoff: { type: "fixed", delay: 5000 },
  removeOnComplete: 200,
  removeOnFail: 500,
};

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Between each recipient: 1–2s pause. Within a chunk, sends are strictly sequential.
 */
export async function runBroadcastChunk(
  recipients: string[],
  subject: string,
  html: string,
): Promise<void> {
  for (const to of recipients) {
    try {
      await deliverBroadcastEmailWithRetries({ to, subject, html });
    } catch (e) {
      logger.error(
        `Broadcast failed permanently for ${to} after retries: ${(e as Error).message}`,
      );
    }
    const delayMs = 1000 + Math.floor(Math.random() * 1000);
    await sleep(delayMs);
  }
}

/**
 * Splits recipients into chunks of 10 and enqueues one job per chunk.
 * Worker concurrency is 1 so chunks never run in parallel.
 */
export async function enqueueBroadcastChunks(
  recipients: string[],
  subject: string,
  html: string,
): Promise<number> {
  const emails = recipients.map((e) => e.trim()).filter(Boolean);
  const chunks: string[][] = [];
  for (let i = 0; i < emails.length; i += BROADCAST_CHUNK_SIZE) {
    chunks.push(emails.slice(i, i + BROADCAST_CHUNK_SIZE));
  }
  if (chunks.length === 0) return 0;

  if (!broadcastChunkQueue) {
    void (async () => {
      for (const c of chunks) {
        try {
          await runBroadcastChunk(c, subject, html);
        } catch (e) {
          logger.error(`Broadcast chunk inline error: ${(e as Error).message}`);
        }
      }
    })();
    return chunks.length;
  }

  for (const chunk of chunks) {
    await broadcastChunkQueue.add(
      "broadcast-chunk",
      { recipients: chunk, subject, html },
      broadcastChunkOpts,
    );
  }
  return chunks.length;
}

export const enqueueEmail = async (
  data: EmailJobData,
  opts?: JobsOptions,
): Promise<void> => {
  try {
    if (!emailQueue) {
      await sendEmailNow(data);
      return;
    }
    await emailQueue.add("send-email", data, { ...defaultOpts, ...opts });
  } catch (err) {
    logger.warn(
      `Queue unavailable, fallback sending email now: ${(err as Error).message}`,
    );
    try {
      await sendEmailNow(data);
    } catch (sendErr) {
      logger.error(`Fallback email failed: ${(sendErr as Error).message}`);
    }
  }
};

let workerStarted = false;
let emailWorker: Worker<EmailJobData> | null = null;
let broadcastChunkWorker: Worker<BroadcastChunkJobData> | null = null;

export const startEmailWorker = (): void => {
  if (workerStarted || !redisEnabled) return;
  workerStarted = true;

  emailWorker = new Worker<EmailJobData>(
    transactionalQueueName,
    async (job) => {
      await sendEmailNow(job.data);
    },
    {
      connection: redisConnection as unknown as ConnectionOptions,
      concurrency: 6,
      limiter: { max: 50, duration: 1000 },
    },
  );

  broadcastChunkWorker = new Worker<BroadcastChunkJobData>(
    broadcastChunkQueueName,
    async (job) => {
      const { recipients, subject, html } = job.data;
      await runBroadcastChunk(recipients, subject, html);
    },
    {
      connection: redisConnection as unknown as ConnectionOptions,
      concurrency: 1,
    },
  );

  emailWorker.on("completed", (job) =>
    logger.info(`Email job completed: ${job.id}`),
  );
  emailWorker.on("failed", (job, err) =>
    logger.error(`Email job failed (${job?.id}): ${err.message}`),
  );
  broadcastChunkWorker.on("failed", (job, err) =>
    logger.error(`Broadcast chunk failed (${job?.id}): ${err.message}`),
  );
};

export const closeEmailWorker = async (): Promise<void> => {
  if (emailWorker) {
    await emailWorker.close();
    emailWorker = null;
  }
  if (broadcastChunkWorker) {
    await broadcastChunkWorker.close();
    broadcastChunkWorker = null;
  }
};
