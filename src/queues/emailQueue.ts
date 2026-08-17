import { Queue, Worker, JobsOptions } from "bullmq";
import {
  bullmqSkipRedisVersionChecks,
  getBullMqQueueConnection,
  getBullMqWorkerConnection,
  isRedisOperational,
} from "../config/redis";
import logger from "../types/utils/logger";
import { sendEmailNow, type EmailAttachment, type EmailPayload } from "../services/emailService";
import { deliverBroadcastEmailWithRetries } from "../services/emailDeliveryService";
import { ConnectionOptions } from "bullmq";
import {
  bullmqRetention,
  bullmqBroadcastRetention,
} from "../config/bullmqRetention";

export type EmailJobData = {
  to: string;
  subject: string;
  html: string;
  text?: string;
  /** Base64-encoded attachment payloads (queue-safe). */
  attachments?: {
    filename: string;
    contentBase64: string;
    contentType?: string;
  }[];
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

const skipBullMqRedisChecks = bullmqSkipRedisVersionChecks();
const transactionalQueueRedis =
  isRedisOperational() ? getBullMqQueueConnection() : null;
const broadcastChunkQueueRedis = transactionalQueueRedis;

export const emailQueue =
  transactionalQueueRedis ?
    new Queue<EmailJobData>(transactionalQueueName, {
      connection: transactionalQueueRedis as unknown as ConnectionOptions,
      skipVersionCheck: skipBullMqRedisChecks,
    })
  : null;

export const broadcastChunkQueue =
  broadcastChunkQueueRedis ?
    new Queue<BroadcastChunkJobData>(broadcastChunkQueueName, {
      connection: broadcastChunkQueueRedis as unknown as ConnectionOptions,
      skipVersionCheck: skipBullMqRedisChecks,
    })
  : null;

const defaultOpts: JobsOptions = {
  attempts: 4,
  backoff: { type: "exponential", delay: 3000 },
  removeOnComplete: bullmqRetention.removeOnComplete,
  removeOnFail: bullmqRetention.removeOnFail,
};

const broadcastChunkOpts: JobsOptions = {
  attempts: 2,
  backoff: { type: "fixed", delay: 5000 },
  removeOnComplete: bullmqBroadcastRetention.removeOnComplete,
  removeOnFail: bullmqBroadcastRetention.removeOnFail,
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

function jobDataToPayload(data: EmailJobData): EmailPayload {
  return {
    to: data.to,
    subject: data.subject,
    html: data.html,
    text: data.text,
    attachments: data.attachments?.map((a) => ({
      filename: a.filename,
      content: a.contentBase64,
      contentType: a.contentType,
    })),
  };
}

export type EnqueueEmailInput = Omit<EmailJobData, "attachments"> & {
  attachments?: EmailAttachment[];
};

export const enqueueEmail = async (
  data: EnqueueEmailInput,
  opts?: JobsOptions,
): Promise<void> => {
  const jobData: EmailJobData = {
    to: data.to,
    subject: data.subject,
    html: data.html,
    text: data.text,
    attachments: data.attachments?.map((a) => ({
      filename: a.filename,
      contentBase64:
        typeof a.content === "string" ?
          a.content
        : a.content.toString("base64"),
      contentType: a.contentType,
    })),
  };
  const payload = jobDataToPayload(jobData);
  try {
    if (!emailQueue) {
      await sendEmailNow(payload);
      return;
    }
    await emailQueue.add("send-email", jobData, { ...defaultOpts, ...opts });
  } catch (err) {
    logger.warn(
      `Queue unavailable, fallback sending email now: ${(err as Error).message}`,
    );
    try {
      await sendEmailNow(payload);
    } catch (sendErr) {
      logger.error(`Fallback email failed: ${(sendErr as Error).message}`);
    }
  }
};

let workerStarted = false;
let emailWorker: Worker<EmailJobData> | null = null;
let broadcastChunkWorker: Worker<BroadcastChunkJobData> | null = null;

export const startEmailWorker = (): void => {
  if (workerStarted || !isRedisOperational()) return;
  workerStarted = true;

  const emailWorkerRedis = getBullMqWorkerConnection();
  const broadcastWorkerRedis = emailWorkerRedis;

  emailWorker = new Worker<EmailJobData>(
    transactionalQueueName,
    async (job) => {
      await sendEmailNow(jobDataToPayload(job.data));
    },
    {
      connection: emailWorkerRedis as unknown as ConnectionOptions,
      skipVersionCheck: skipBullMqRedisChecks,
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
      connection: broadcastWorkerRedis as unknown as ConnectionOptions,
      skipVersionCheck: skipBullMqRedisChecks,
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
