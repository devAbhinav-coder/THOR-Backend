import { Queue, Worker, JobsOptions } from 'bullmq';
import { redisConnection, redisEnabled } from '../config/redis';
import logger from '../utils/logger';
import { sendEmailNow } from '../services/emailService';
import { ConnectionOptions } from 'bullmq';

export type EmailJobData = {
  to: string;
  subject: string;
  html: string;
  text?: string;
};

const transactionalQueueName = 'email-jobs-transactional';
const broadcastQueueName = 'email-jobs-broadcast';

export const emailQueue = redisEnabled
  ? new Queue<EmailJobData>(transactionalQueueName, {
      connection: redisConnection as unknown as ConnectionOptions,
    })
  : null;
export const broadcastEmailQueue = redisEnabled
  ? new Queue<EmailJobData>(broadcastQueueName, {
      connection: redisConnection as unknown as ConnectionOptions,
    })
  : null;

const defaultOpts: JobsOptions = {
  attempts: 4,
  backoff: { type: 'exponential', delay: 3000 },
  removeOnComplete: 500,
  removeOnFail: 1000,
};

export const enqueueEmail = async (data: EmailJobData, opts?: JobsOptions): Promise<void> => {
  try {
    if (!emailQueue) {
      await sendEmailNow(data);
      return;
    }
    await emailQueue.add('send-email', data, { ...defaultOpts, ...opts });
  } catch (err) {
    logger.warn(`Queue unavailable, fallback sending email now: ${(err as Error).message}`);
    try {
      await sendEmailNow(data);
    } catch (sendErr) {
      logger.error(`Fallback email failed: ${(sendErr as Error).message}`);
    }
  }
};

export const enqueueBroadcastEmail = async (data: EmailJobData, opts?: JobsOptions): Promise<void> => {
  try {
    if (!broadcastEmailQueue) {
      await sendEmailNow(data);
      return;
    }
    await broadcastEmailQueue.add('send-broadcast-email', data, {
      ...defaultOpts,
      priority: 10,
      ...opts,
    });
  } catch (err) {
    logger.warn(`Queue unavailable, fallback sending email now: ${(err as Error).message}`);
    try {
      await sendEmailNow(data);
    } catch (sendErr) {
      logger.error(`Fallback email failed: ${(sendErr as Error).message}`);
    }
  }
};

let workerStarted = false;
let emailWorker: Worker<EmailJobData> | null = null;
let broadcastWorker: Worker<EmailJobData> | null = null;

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
    }
  );
  broadcastWorker = new Worker<EmailJobData>(
    broadcastQueueName,
    async (job) => {
      await sendEmailNow(job.data);
    },
    {
      connection: redisConnection as unknown as ConnectionOptions,
      concurrency: 2,
      limiter: { max: 20, duration: 1000 },
    }
  );

  emailWorker.on('completed', (job) => logger.info(`Email job completed: ${job.id}`));
  emailWorker.on('failed', (job, err) =>
    logger.error(`Email job failed (${job?.id}): ${err.message}`)
  );
  broadcastWorker.on('failed', (job, err) =>
    logger.error(`Broadcast email failed (${job?.id}): ${err.message}`)
  );
};

export const closeEmailWorker = async (): Promise<void> => {
  if (emailWorker) {
    await emailWorker.close();
    emailWorker = null;
  }
  if (broadcastWorker) {
    await broadcastWorker.close();
    broadcastWorker = null;
  }
};

