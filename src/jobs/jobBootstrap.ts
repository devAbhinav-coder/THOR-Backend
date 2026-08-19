import connectDB from "../config/db";
import logger from "../types/utils/logger";
import {
  closeAllRedisConnections,
  isRedisOperational,
} from "../config/redis";
import mongoose from "mongoose";
import { shouldRunBackgroundJobs, shouldRunQueueWorkers } from "../config/runMode";
import {
  ensureRedisReady,
  assertWorkerInfrastructure,
} from "../config/infrastructureReadiness";
import { broadcastNewBlog } from "../controllers/blogController";
import {
  startOrderOutboxPoller,
  stopOrderOutboxPoller,
} from "./orderOutboxPoller";
import {
  startInventoryOutboxPoller,
  stopInventoryOutboxPoller,
} from "./inventoryOutboxPoller";
import {
  startCouponOutboxPoller,
  stopCouponOutboxPoller,
} from "./couponOutboxPoller";
import {
  startInventoryReconciliationJob,
  stopInventoryReconciliationJob,
} from "./inventoryReconciliationJob";
import {
  startGiftingOutboxPoller,
  stopGiftingOutboxPoller,
} from "./giftingOutboxPoller";
import {
  startPushOutboxPoller,
  stopPushOutboxPoller,
} from "./pushOutboxPoller";
import {
  startCartOutboxPoller,
  stopCartOutboxPoller,
} from "./cartOutboxPoller";
import {
  startCartSyncSubscriber,
  stopCartSyncSubscriber,
} from "../workers/cartSyncSubscriber";
import {
  startNotificationMaintenanceJob,
  stopNotificationMaintenanceJob,
} from "./notificationMaintenanceJob";
import {
  startBlogPublishJob,
  stopBlogPublishJob,
  setBlogPublishHook,
} from "./blogPublishJob";
import {
  startDelhiveryTrackingSyncJob,
  stopDelhiveryTrackingSyncJob,
} from "./delhiveryTrackingSyncJob";
import {
  startPaymentRecoveryJob,
  stopPaymentRecoveryJob,
} from "./paymentRecoveryJob";
import {
  startEmbeddingBackfillJob,
  stopEmbeddingBackfillJob,
} from "./embeddingBackfillJob";
import { startExtendedJobs, stopExtendedJobs } from "./extendedJobsRegistry";
import { stopAllScheduledJobs } from "./scheduledRunner";

let started = false;

type QueueWorkerHandles = {
  closeEmailWorker: () => Promise<void>;
  closePushWorker: () => Promise<void>;
  closeImageWorker: () => Promise<void>;
  closeOrderWorker: () => Promise<void>;
  closeMaintenanceWorker: () => Promise<void>;
  emailQueue: { close: () => Promise<void> } | null;
  pushQueue: { close: () => Promise<void> } | null;
  imageQueue: { close: () => Promise<void> } | null;
  orderQueue: { close: () => Promise<void> } | null;
  maintenanceQueue: { close: () => Promise<void> } | null;
};

let queueWorkerHandles: QueueWorkerHandles | null = null;

async function startQueueWorkersIfNeeded(): Promise<void> {
  if (!shouldRunQueueWorkers()) return;

  const [
    emailMod,
    pushMod,
    imageMod,
    orderWorkerMod,
    orderQueueMod,
    maintenanceMod,
  ] = await Promise.all([
    import("../queues/emailQueue"),
    import("../queues/pushQueue"),
    import("../queues/imageQueue"),
    import("../workers/orderWorker"),
    import("../queues/orderQueue"),
    import("../queues/maintenanceQueue"),
  ]);

  emailMod.startEmailWorker();
  pushMod.startPushWorker();
  imageMod.startImageWorker();
  orderWorkerMod.startOrderWorker();
  maintenanceMod.startMaintenanceWorker();
  logger.info("BullMQ workers started");

  queueWorkerHandles = {
    closeEmailWorker: emailMod.closeEmailWorker,
    closePushWorker: pushMod.closePushWorker,
    closeImageWorker: imageMod.closeImageWorker,
    closeOrderWorker: orderWorkerMod.closeOrderWorker,
    closeMaintenanceWorker: maintenanceMod.closeMaintenanceWorker,
    emailQueue: emailMod.emailQueue,
    pushQueue: pushMod.pushQueue,
    imageQueue: imageMod.imageQueue,
    orderQueue: orderQueueMod.orderQueue,
    maintenanceQueue: maintenanceMod.maintenanceQueue,
  };
}

export function startAllBackgroundWork(): void {
  if (started) return;

  if (shouldRunQueueWorkers()) {
    void startQueueWorkersIfNeeded().catch((err: unknown) => {
      logger.error(`BullMQ workers failed to start: ${(err as Error).message}`);
    });
  }

  if (!shouldRunBackgroundJobs()) {
    logger.info("Background jobs skipped (JOBS_ENABLED=false or RUN_MODE=api)");
    started = true;
    return;
  }

  startOrderOutboxPoller();
  startInventoryOutboxPoller();
  startCouponOutboxPoller();
  startInventoryReconciliationJob();
  startGiftingOutboxPoller();
  startPushOutboxPoller();
  startCartOutboxPoller();
  startCartSyncSubscriber();
  startNotificationMaintenanceJob();
  setBlogPublishHook(broadcastNewBlog);
  startBlogPublishJob();
  startDelhiveryTrackingSyncJob();
  startPaymentRecoveryJob();
  startEmbeddingBackfillJob();
  startExtendedJobs();

  logger.info("All background jobs started");
  started = true;
}

export async function stopAllBackgroundWork(): Promise<void> {
  if (!started) return;

  stopOrderOutboxPoller();
  stopInventoryOutboxPoller();
  stopCouponOutboxPoller();
  stopInventoryReconciliationJob();
  stopGiftingOutboxPoller();
  stopPushOutboxPoller();
  stopCartOutboxPoller();
  await stopCartSyncSubscriber();
  stopNotificationMaintenanceJob();
  stopBlogPublishJob();
  stopDelhiveryTrackingSyncJob();
  stopPaymentRecoveryJob();
  stopEmbeddingBackfillJob();
  stopExtendedJobs();
  stopAllScheduledJobs();

  if (queueWorkerHandles) {
    const h = queueWorkerHandles;
    await h.closeEmailWorker();
    await h.closePushWorker();
    await h.closeImageWorker();
    await h.closeOrderWorker();
    await h.closeMaintenanceWorker();
    if (h.emailQueue) await h.emailQueue.close();
    if (h.pushQueue) await h.pushQueue.close();
    if (h.imageQueue) await h.imageQueue.close();
    if (h.orderQueue) await h.orderQueue.close();
    if (h.maintenanceQueue) await h.maintenanceQueue.close();
    queueWorkerHandles = null;
  }

  started = false;
}

/** Standalone worker entry — DB + jobs only, no HTTP. */
export async function bootstrapWorkerProcess(): Promise<void> {
  await ensureRedisReady();
  await connectDB();
  await assertWorkerInfrastructure();

  if (process.env.NODE_ENV === "production" && !isRedisOperational()) {
    throw new Error("Redis ping failed — worker cannot start without Redis");
  }

  startAllBackgroundWork();

  // Periodic Redis heartbeat — reconnect after transient outages.
  const heartbeatMs = Number(process.env.REDIS_HEARTBEAT_MS || 60_000);
  if (heartbeatMs > 0 && isRedisOperational()) {
    setInterval(() => {
      void ensureRedisReady().then((ok) => {
        if (!ok && process.env.NODE_ENV === "production") {
          logger.error("Redis heartbeat failed in production worker");
        }
      });
    }, heartbeatMs).unref();
  }

  logger.info("Worker process ready");
}

export async function shutdownWorkerProcess(signal: string): Promise<void> {
  logger.info(`${signal} received — shutting down worker...`);
  try {
    await stopAllBackgroundWork();
    await mongoose.connection.close();
    await closeAllRedisConnections();
    logger.info("Worker shutdown complete");
  } catch (err: unknown) {
    logger.error(`Worker shutdown error: ${(err as Error).message}`);
  } finally {
    process.exit(0);
  }
}
