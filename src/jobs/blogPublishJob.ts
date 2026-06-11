import Blog from '../models/Blog';
import logger from '../types/utils/logger';
import { syncBlogEmbedding } from '../services/ai/vectorIndexService';

const DEFAULT_INTERVAL_MS = Number(
  process.env.BLOG_PUBLISH_POLL_MS || 60 * 1000,
);

let timer: ReturnType<typeof setInterval> | null = null;

type BlogPublishHook = (blog: { _id: unknown; title: string; slug: string; isPublished: boolean }) => Promise<void>;

let onPublishHook: BlogPublishHook | null = null;

export function setBlogPublishHook(hook: BlogPublishHook): void {
  onPublishHook = hook;
}

async function publishDueBlogs(): Promise<number> {
  const now = new Date();
  const due = await Blog.find({
    isPublished: false,
    scheduledPublishAt: { $lte: now, $ne: null },
  }).select('_id title slug isPublished');

  let count = 0;
  for (const blog of due) {
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
      }).catch(() => {});
    }
    count += 1;
    logger.info('Scheduled blog published', { blogId: String(blog._id), slug: blog.slug });
  }
  return count;
}

export function startBlogPublishJob(): void {
  if (timer) return;
  if (process.env.BLOG_PUBLISH_JOB_ENABLED === 'false') {
    logger.info('Blog publish job disabled');
    return;
  }

  const tick = () => void publishDueBlogs().catch((err) => {
    logger.error('Blog publish job error', { error: (err as Error).message });
  });

  tick();
  timer = setInterval(tick, DEFAULT_INTERVAL_MS);
  logger.info(`Blog scheduled publish job started (${DEFAULT_INTERVAL_MS}ms)`);
}

export function stopBlogPublishJob(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
