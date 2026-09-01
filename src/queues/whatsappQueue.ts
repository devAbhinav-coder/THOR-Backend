import { Queue, Worker, JobsOptions } from "bullmq";
import type { ConnectionOptions } from "bullmq";
import {
  bullmqSkipRedisVersionChecks,
  getBullMqQueueConnection,
  getBullMqWorkerConnection,
  isRedisOperational,
} from "../config/redis";
import { bullmqRetention } from "../config/bullmqRetention";
import { sendWhatsAppTemplate } from "../services/whatsappCloudService";
import {
  logWhatsAppQueued,
  logWhatsAppResult,
} from "../services/whatsappLogService";
import { processWhatsAppHandoverPack, processWhatsAppDeliveredPack } from "../services/whatsappHandoverService";
import type { WhatsAppMessageCategory } from "../models/WhatsAppMessageLog";
import logger from "../types/utils/logger";

export type WhatsAppJobData =
  | {
      kind: "template";
      to: string;
      template: string;
      bodyParams: string[];
      category?: WhatsAppMessageCategory;
      userId?: string;
      orderId?: string;
      campaignSubject?: string;
      logId?: string;
    }
  | {
      kind: "handover_pack";
      to: string;
      userId: string;
      orderId: string;
      orderNumber: string;
      total: number;
      customerName: string;
      logId?: string;
    }
  | {
      kind: "delivered_pack";
      to: string;
      userId: string;
      orderId: string;
      orderNumber: string;
      total: number;
      customerName: string;
      logId?: string;
    };

const queueName = "whatsapp-jobs";
const skipBullMqRedisChecks = bullmqSkipRedisVersionChecks();
const queueRedis = isRedisOperational() ? getBullMqQueueConnection() : null;

export const whatsappQueue =
  queueRedis ?
    new Queue<WhatsAppJobData>(queueName, {
      connection: queueRedis as unknown as ConnectionOptions,
      skipVersionCheck: skipBullMqRedisChecks,
    })
  : null;

const defaultOpts: JobsOptions = {
  attempts: 3,
  backoff: { type: "exponential", delay: 4000 },
  removeOnComplete: bullmqRetention.removeOnComplete,
  removeOnFail: bullmqRetention.removeOnFail,
};

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export async function enqueueWhatsApp(
  data: Omit<Extract<WhatsAppJobData, { kind: "template" }>, "kind"> & {
    kind?: "template";
  },
): Promise<string | undefined> {
  const to = data.to.trim();
  if (!to || !data.template) return undefined;

  const jobData: Extract<WhatsAppJobData, { kind: "template" }> = {
    kind: "template",
    ...data,
    to,
  };

  let logId = jobData.logId;
  if (!logId) {
    logId = await logWhatsAppQueued({
      to,
      template: jobData.template,
      category: jobData.category || "other",
      bodyParams: jobData.bodyParams,
      userId: jobData.userId,
      orderId: jobData.orderId,
      campaignSubject: jobData.campaignSubject,
    });
  }

  const payload = { ...jobData, logId };

  if (!whatsappQueue) {
    const result = await sendWhatsAppTemplate(payload);
    await logWhatsAppResult(logId, result);
    return logId;
  }

  await whatsappQueue.add("template", payload, defaultOpts);
  return logId;
}

export async function enqueueWhatsAppHandoverPack(
  data: Omit<Extract<WhatsAppJobData, { kind: "handover_pack" }>, "kind" | "logId">,
): Promise<void> {
  const to = data.to.trim();
  if (!to) return;

  const job: Extract<WhatsAppJobData, { kind: "handover_pack" }> = {
    kind: "handover_pack",
    ...data,
    to,
  };

  if (!whatsappQueue) {
    await processWhatsAppHandoverPack(job);
    return;
  }

  await whatsappQueue.add("handover_pack", job, defaultOpts);
}

export async function enqueueWhatsAppDeliveredPack(
  data: Omit<Extract<WhatsAppJobData, { kind: "delivered_pack" }>, "kind" | "logId">,
): Promise<void> {
  const to = data.to.trim();
  if (!to) return;

  const job: Extract<WhatsAppJobData, { kind: "delivered_pack" }> = {
    kind: "delivered_pack",
    ...data,
    to,
  };

  if (!whatsappQueue) {
    await processWhatsAppDeliveredPack(job);
    return;
  }

  await whatsappQueue.add("delivered_pack", job, defaultOpts);
}

export async function enqueueWhatsAppMany(
  jobs: Array<Omit<Extract<WhatsAppJobData, { kind: "template" }>, "kind">>,
): Promise<number> {
  let n = 0;
  for (const job of jobs) {
    await enqueueWhatsApp(job);
    n += 1;
  }
  return n;
}

let worker: Worker<WhatsAppJobData> | null = null;

export function startWhatsAppWorker(): void {
  if (worker || !isRedisOperational()) return;
  worker = new Worker<WhatsAppJobData>(
    queueName,
    async (job) => {
      if (job.data.kind === "handover_pack") {
        await processWhatsAppHandoverPack(job.data);
        await sleep(400);
        return;
      }
      if (job.data.kind === "delivered_pack") {
        await processWhatsAppDeliveredPack(job.data);
        await sleep(400);
        return;
      }

      const tplJob =
        job.data.kind === "template" ? job.data : (
          {
            ...(job.data as Omit<Extract<WhatsAppJobData, { kind: "template" }>, "kind">),
            kind: "template" as const,
          }
        );
      const result = await sendWhatsAppTemplate(tplJob);
      await logWhatsAppResult(tplJob.logId, result);
      if (!result.ok) {
        throw new Error(result.errorMessage || "WhatsApp send failed");
      }
      await sleep(200);
    },
    {
      connection: getBullMqWorkerConnection() as unknown as ConnectionOptions,
      concurrency: 1,
      skipVersionCheck: skipBullMqRedisChecks,
    },
  );
  worker.on("failed", (job, err) => {
    logger.warn({
      msg: "whatsapp_job_failed",
      id: job?.id,
      kind: job?.data.kind,
      logId: job?.data.kind === "template" ? job.data.logId : undefined,
      error: err.message,
    });
  });
}

export async function closeWhatsAppWorker(): Promise<void> {
  if (worker) {
    await worker.close();
    worker = null;
  }
}

export async function getWhatsAppQueueCounts(): Promise<{
  waiting: number;
  active: number;
  failed: number;
  completed: number;
} | null> {
  if (!whatsappQueue) return null;
  const counts = await whatsappQueue.getJobCounts(
    "waiting",
    "active",
    "failed",
    "completed",
  );
  return {
    waiting: counts.waiting ?? 0,
    active: counts.active ?? 0,
    failed: counts.failed ?? 0,
    completed: counts.completed ?? 0,
  };
}
