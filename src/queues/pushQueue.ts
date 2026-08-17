import { Queue, Worker, JobsOptions } from "bullmq";
import { ConnectionOptions } from "bullmq";
import {
  bullmqSkipRedisVersionChecks,
  getBullMqQueueConnection,
  getBullMqWorkerConnection,
  isRedisOperational,
} from "../config/redis";
import logger from "../types/utils/logger";
import { sendWebPushToUser } from "../services/webPushService";
import { markPushDelivered } from "../services/notifications/pushDeliveryTrackingService";
import { bullmqPushRetention } from "../config/bullmqRetention";

export type PushJobData = {
  userId: string;
  title: string;
  body: string;
  link?: string;
  notificationId?: string;
};

const queueName = "push-notification-jobs";
const skipBullMqRedisChecks = bullmqSkipRedisVersionChecks();
const pushQueueRedis = isRedisOperational() ? getBullMqQueueConnection() : null;

export const pushQueue =
  pushQueueRedis ?
    new Queue<PushJobData>(queueName, {
      connection: pushQueueRedis as unknown as ConnectionOptions,
      skipVersionCheck: skipBullMqRedisChecks,
    })
  : null;

const defaultOpts: JobsOptions = {
  attempts: 4,
  backoff: { type: "exponential", delay: 3000 },
  removeOnComplete: bullmqPushRetention.removeOnComplete,
  removeOnFail: bullmqPushRetention.removeOnFail,
};

export async function enqueuePush(
  data: PushJobData,
  opts?: JobsOptions,
): Promise<void> {
  try {
    if (!pushQueue) {
      await sendWebPushToUser(data.userId, {
        title: data.title,
        body: data.body,
        link: data.link,
        tag:
          data.notificationId ?
            `notif-${data.notificationId}`
          : "in-app-notification",
      });
      return;
    }
    await pushQueue.add("send-push", data, {
      ...defaultOpts,
      jobId:
        data.notificationId ?
          `push__${data.userId}__${data.notificationId}`
        : undefined,
      ...opts,
    });
  } catch (err) {
    logger.error("Failed to enqueue push notification", {
      err,
      userId: data.userId,
    });
  }
}

let workerStarted = false;
let pushWorker: Worker<PushJobData> | null = null;

export const startPushWorker = (): void => {
  if (workerStarted || !isRedisOperational()) return;
  workerStarted = true;

  const pushWorkerRedis = getBullMqWorkerConnection();

  pushWorker = new Worker<PushJobData>(
    queueName,
    async (job) => {
      try {
        await sendWebPushToUser(job.data.userId, {
          title: job.data.title,
          body: job.data.body,
          link: job.data.link,
          tag:
            job.data.notificationId ?
              `notif-${job.data.notificationId}`
            : "in-app-notification",
        });
        await markPushDelivered(job.data.userId, job.data.notificationId);
      } catch (err: unknown) {
        const message =
          err instanceof Error ? err.message : "push worker failed";
        await markPushDelivered(
          job.data.userId,
          job.data.notificationId,
          message,
        );
        throw err;
      }
    },
    {
      connection: pushWorkerRedis as unknown as ConnectionOptions,
      skipVersionCheck: skipBullMqRedisChecks,
      concurrency: 10,
      limiter: { max: 100, duration: 1000 },
    },
  );

  pushWorker.on("failed", (job, err) => {
    logger.error(`Push job failed (${job?.id}): ${err.message}`);
  });
};

export const closePushWorker = async (): Promise<void> => {
  if (pushWorker) {
    await pushWorker.close();
    pushWorker = null;
  }
};
