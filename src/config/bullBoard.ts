import type { Express } from "express";
import { ExpressAdapter } from "@bull-board/express";
import { isRedisOperational } from "./redis";
import { protect, restrictTo } from "../middleware/auth";
import logger from "../types/utils/logger";

const BASE_PATH = "/api/admin/queues";

/**
 * Mount Bull Board UI for visual queue monitoring (admin-only).
 * Queues are imported lazily so API-only dev does not open BullMQ Redis connections.
 */
export async function setupBullBoard(app: Express): Promise<void> {
  if (process.env.BULL_BOARD_ENABLED !== "true") {
    return;
  }
  if (!isRedisOperational()) {
    logger.warn("Bull Board skipped — Redis not configured");
    return;
  }

  const [{ createBullBoard }, { BullMQAdapter }, queues] = await Promise.all([
    import("@bull-board/api"),
    import("@bull-board/api/bullMQAdapter"),
    import("../queues/bullBoardQueues"),
  ]);

  const list = [
    queues.emailQueue,
    queues.broadcastChunkQueue,
    queues.pushQueue,
    queues.imageQueue,
    queues.orderQueue,
    queues.maintenanceQueue,
  ].filter((q): q is NonNullable<typeof q> => q !== null);

  if (list.length === 0) {
    logger.warn("Bull Board skipped — no queues available");
    return;
  }

  const serverAdapter = new ExpressAdapter();
  serverAdapter.setBasePath(BASE_PATH);

  createBullBoard({
    queues: list.map((q) => new BullMQAdapter(q)),
    serverAdapter,
  });

  app.use(BASE_PATH, protect, restrictTo("admin"), serverAdapter.getRouter());
  logger.info(`Bull Board mounted at ${BASE_PATH}`);
}
