import { Queue, Worker, JobsOptions } from 'bullmq';
import { ConnectionOptions } from 'bullmq';
import { redisConnection, redisEnabled } from '../config/redis';
import logger from '../utils/logger';
import { sendWebPushToUser } from '../services/webPushService';

export type PushJobData = {
  userId: string;
  title: string;
  body: string;
  link?: string;
  notificationId?: string;
};

const queueName = 'push-notification-jobs';
export const pushQueue = redisEnabled
  ? new Queue<PushJobData>(queueName, {
      connection: redisConnection as unknown as ConnectionOptions,
    })
  : null;

const defaultOpts: JobsOptions = {
  attempts: 4,
  backoff: { type: 'exponential', delay: 3000 },
  removeOnComplete: 1000,
  removeOnFail: 1000,
};

export async function enqueuePush(data: PushJobData, opts?: JobsOptions): Promise<void> {
  try {
    if (!pushQueue) {
      await sendWebPushToUser(data.userId, {
        title: data.title,
        body: data.body,
        link: data.link,
        tag: data.notificationId ? `notif-${data.notificationId}` : 'in-app-notification',
      });
      return;
    }
    await pushQueue.add('send-push', data, {
      ...defaultOpts,
      jobId: data.notificationId ? `push:${data.userId}:${data.notificationId}` : undefined,
      ...opts,
    });
  } catch (err) {
    logger.error('Failed to enqueue push notification', { err, userId: data.userId });
  }
}

let workerStarted = false;
let pushWorker: Worker<PushJobData> | null = null;

export const startPushWorker = (): void => {
  if (workerStarted || !redisEnabled) return;
  workerStarted = true;

  pushWorker = new Worker<PushJobData>(
    queueName,
    async (job) => {
      await sendWebPushToUser(job.data.userId, {
        title: job.data.title,
        body: job.data.body,
        link: job.data.link,
        tag: job.data.notificationId ? `notif-${job.data.notificationId}` : 'in-app-notification',
      });
    },
    {
      connection: redisConnection as unknown as ConnectionOptions,
      concurrency: 10,
      limiter: { max: 100, duration: 1000 },
    }
  );

  pushWorker.on('failed', (job, err) => {
    logger.error(`Push job failed (${job?.id}): ${err.message}`);
  });
};

export const closePushWorker = async (): Promise<void> => {
  if (pushWorker) {
    await pushWorker.close();
    pushWorker = null;
  }
};

