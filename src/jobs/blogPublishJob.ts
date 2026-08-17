import logger from "../types/utils/logger";
import { withPollerLock } from "./pollerLock";
import { startScheduledJob } from "./scheduledRunner";
import {
  backfillBlogPublishOutbox,
  processPendingBlogPublishBatch,
  setBlogPublishHook,
} from "../services/blogPublishOutboxService";

export { setBlogPublishHook };

const DEFAULT_INTERVAL_MS = Number(
  process.env.BLOG_PUBLISH_POLL_MS || 60 * 1000,
);

let stopJob: (() => void) | null = null;

export function startBlogPublishJob(): void {
  if (stopJob) return;
  if (process.env.BLOG_PUBLISH_JOB_ENABLED === "false") {
    logger.info("Blog publish job disabled");
    return;
  }

  const lockTtlMs = Math.max(Math.floor(DEFAULT_INTERVAL_MS * 0.9), 10_000);

  stopJob = startScheduledJob({
    name: "blog-publish",
    intervalMs: DEFAULT_INTERVAL_MS,
    onTick: async () => {
      await withPollerLock("blog-publish", lockTtlMs, async () => {
        const count = await processPendingBlogPublishBatch();
        if (count > 0) {
          logger.info({ msg: "blog_publish_poller_dispatched", count });
        }
      });
    },
    onError: (err: unknown) => {
      logger.error("Blog publish job error", {
        error: (err as Error).message,
      });
    },
  });

  void backfillBlogPublishOutbox()
    .then((n) => {
      if (n > 0) {
        logger.info({ msg: "blog_publish_outbox_backfilled", count: n });
      }
    })
    .catch((err: unknown) => {
      logger.warn({
        msg: "blog_publish_outbox_backfill_failed",
        error: err instanceof Error ? err.message : "backfill failed",
      });
    });

  logger.info(
    `Blog scheduled publish job started (${DEFAULT_INTERVAL_MS}ms, outbox-backed)`,
  );
}

export function stopBlogPublishJob(): void {
  if (stopJob) {
    stopJob();
    stopJob = null;
  }
}
