/**
 * Backfill blog SEO fields for existing posts.
 *
 * Run: npx ts-node --transpile-only scripts/backfill-blog-seo-fields.ts
 * Or:  npm run backfill:blog-seo
 */
import "dotenv/config";
import connectDB from "../src/config/db";
import Blog from "../src/models/Blog";
import {
  computeReadingTimeMin,
  plainBlogExcerpt,
} from "../src/types/utils/blogContent";

async function main() {
  await connectDB();

  const blogs = await Blog.find({}).select(
    "title content excerpt seoTitle seoDescription readingTimeMin tags category keywords",
  );
  let updated = 0;

  for (const blog of blogs) {
    const content = String(blog.content || "");
    const excerpt = blog.excerpt || plainBlogExcerpt(content, 180);
    const patch: Record<string, unknown> = {};

    if (!blog.excerpt) patch.excerpt = excerpt;
    if (!blog.seoTitle) patch.seoTitle = String(blog.title || "").slice(0, 70);
    if (!blog.seoDescription) patch.seoDescription = excerpt.slice(0, 170);
    if (!blog.readingTimeMin || blog.readingTimeMin < 1) {
      patch.readingTimeMin = computeReadingTimeMin(content);
    }
    if (!blog.tags?.length) patch.tags = [];
    if (!blog.keywords?.length) patch.keywords = [];
    if (!blog.category) patch.category = "saree-styling";

    if (Object.keys(patch).length > 0) {
      await Blog.updateOne({ _id: blog._id }, { $set: patch });
      updated += 1;
    }
  }

  await Blog.syncIndexes();

  console.log("Blog SEO backfill complete.", {
    total: blogs.length,
    updated,
  });

  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
