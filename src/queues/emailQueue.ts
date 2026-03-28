import { Queue, Worker, JobsOptions } from 'bullmq';
import { redisConnection } from '../config/redis';
import logger from '../utils/logger';
import { sendEmailNow } from '../services/emailService';

export type EmailJobData = {
  to: string;
  subject: string;
  html: string;
  text?: string;
};

const queueName = 'email-jobs';

export const emailQueue = new Queue<EmailJobData>(queueName, {
  connection: redisConnection,
});

export const enqueueEmail = async (data: EmailJobData, opts?: JobsOptions): Promise<void> => {
  try {
    await emailQueue.add('send-email', data, {
      attempts: 4,
      backoff: { type: 'exponential', delay: 3000 },
      removeOnComplete: 500,
      removeOnFail: 1000,
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

export const startEmailWorker = (): void => {
  if (workerStarted) return;
  workerStarted = true;

  emailWorker = new Worker<EmailJobData>(
    queueName,
    async (job) => {
      await sendEmailNow(job.data);
    },
    { connection: redisConnection, concurrency: 5 }
  );

  emailWorker.on('completed', (job) => logger.info(`Email job completed: ${job.id}`));
  emailWorker.on('failed', (job, err) =>
    logger.error(`Email job failed (${job?.id}): ${err.message}`)
  );
};

export const closeEmailWorker = async (): Promise<void> => {
  if (emailWorker) {
    await emailWorker.close();
    emailWorker = null;
  }
};

