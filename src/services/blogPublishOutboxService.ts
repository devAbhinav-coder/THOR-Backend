import Blog from "../models/Blog";
import BlogPublishOutbox from "../models/BlogPublishOutbox";
import logger from "../types/utils/logger";
import { syncBlogEmbedding } from "./ai/vectorIndexService";
import {
  logOutboxDeadLetter,
  nextOutboxStatusAfterFailure,
} from "./outboxDeadLetter";

const MAX_ATTEMPTS = 6;
const BASE_BACKOFF_MS = 2000;

export type BlogPublishHook = (blog: {
  _id: unknown;
  title: string;
  slug: string;
  isPublished: boolean;
}) => Promise<void>;

let onPublishHook: BlogPublishHook | null = null;

export function setBlogPublishHook(hook: BlogPublishHook): void {
  onPublishHook = hook;
}

function nextBackoffMs(attempts: number): number {
  return Math.min(BASE_BACKOFF_MS * 2 ** attempts, 60 * 60 * 1000);
}

function buildDedupeKey(blogId: string): string {
  return `blog:publish:${blogId}`;
}

/** Record a durable publish intent when a blog is scheduled. */
export async function recordBlogPublishOutbox(
  blogId: string,
  scheduledPublishAt: Date,
): Promise<string | null> {
  const dedupeKey = buildDedupeKey(blogId);

  try {
    const doc = await BlogPublishOutbox.findOneAndUpdate(
      { dedupeKey },
      {
        $set: {
          blogId,
          scheduledPublishAt,
          nextAttemptAt: scheduledPublishAt,
        },
        $setOnInsert: {
          dedupeKey,
          status: "pending",
          attempts: 0,
        },
      },
      { upsert: true, new: true },
    ).lean();

    return doc ? String(doc._id) : null;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "outbox write failed";
    logger.error({
      msg: "blog_publish_outbox_persist_failed",
      blogId,
      error: message,
    });
    return null;
  }
}

/** Cancel pending outbox entry when schedule is cleared or blog is published immediately. */
export async function cancelBlogPublishOutbox(blogId: string): Promise<void> {
  await BlogPublishOutbox.updateOne(
    {
      dedupeKey: buildDedupeKey(blogId),
      status: { $in: ["pending", "failed"] },
    },
    { $set: { status: "completed", processedAt: new Date() } },
  );
}

async function publishBlogFromOutbox(blogId: string): Promise<void> {
  const blog = await Blog.findById(blogId).select(
    "_id title slug isPublished scheduledPublishAt",
  );
  if (!blog) {
    throw new Error(`Blog ${blogId} not found`);
  }
  if (blog.isPublished) return;

  blog.isPublished = true;
  blog.scheduledPublishAt = null;
  await blog.save();
  await syncBlogEmbedding(String(blog._id)).catch(() => {});

  if (onPublishHook) {
    await onPublishHook({
      _id: blog._id,
      title: blog.title,
      slug: blog.slug,
      isPublished: true,
    });
  }

  logger.info("Scheduled blog published via outbox", {
    blogId: String(blog._id),
    slug: blog.slug,
  });
}

export async function dispatchBlogPublishOutboxById(
  outboxId: string,
): Promise<boolean> {
  const claimed = await BlogPublishOutbox.findOneAndUpdate(
    {
      _id: outboxId,
      status: { $in: ["pending", "failed"] },
      nextAttemptAt: { $lte: new Date() },
    },
    { $set: { status: "processing" }, $inc: { attempts: 1 } },
    { new: true },
  );

  if (!claimed) return false;

  try {
    await publishBlogFromOutbox(claimed.blogId);
    await BlogPublishOutbox.updateOne(
      { _id: claimed._id },
      {
        $set: {
          status: "completed",
          processedAt: new Date(),
          lastError: undefined,
        },
      },
    );
    return true;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "publish failed";
    const attempts = claimed.attempts;
    const terminal = attempts >= MAX_ATTEMPTS;
    const nextStatus = nextOutboxStatusAfterFailure(attempts, MAX_ATTEMPTS);
    await BlogPublishOutbox.updateOne(
      { _id: claimed._id },
      {
        $set: {
          status: nextStatus,
          lastError: message.slice(0, 500),
          nextAttemptAt: new Date(Date.now() + nextBackoffMs(attempts)),
        },
      },
    );
    if (terminal) {
      logOutboxDeadLetter(
        "blog_publish",
        String(claimed._id),
        claimed.dedupeKey,
        attempts,
        message,
      );
    }
    return false;
  }
}

/** Backfill outbox for blogs scheduled before outbox was introduced. */
export async function backfillBlogPublishOutbox(): Promise<number> {
  const due = await Blog.find({
    isPublished: false,
    scheduledPublishAt: { $ne: null },
  })
    .select("_id scheduledPublishAt")
    .lean();

  let count = 0;
  for (const blog of due) {
    if (!blog.scheduledPublishAt) continue;
    const id = await recordBlogPublishOutbox(
      String(blog._id),
      blog.scheduledPublishAt,
    );
    if (id) count += 1;
  }
  return count;
}

export async function processPendingBlogPublishBatch(
  limit = 20,
): Promise<number> {
  const pending = await BlogPublishOutbox.find({
    status: { $in: ["pending", "failed"] },
    nextAttemptAt: { $lte: new Date() },
    attempts: { $lt: MAX_ATTEMPTS },
  })
    .sort({ nextAttemptAt: 1 })
    .limit(limit)
    .select("_id")
    .lean()
    .maxTimeMS(5000);

  let dispatched = 0;
  for (const row of pending) {
    if (await dispatchBlogPublishOutboxById(String(row._id))) {
      dispatched += 1;
    }
  }
  return dispatched;
}
