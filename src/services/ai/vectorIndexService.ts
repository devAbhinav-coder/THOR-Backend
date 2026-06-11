import Blog from '../../models/Blog';
import Product from '../../models/Product';
import {
  blogEmbedSource,
  cosineSimilarity,
  embedText,
  productEmbedSource,
} from './textEmbedding';
import logger from '../../types/utils/logger';

type ScoredDoc<T> = { doc: T; score: number };

function topK<T extends { contentEmbedding?: number[] }>(
  queryVec: number[],
  docs: T[],
  limit: number,
): ScoredDoc<T>[] {
  return docs
    .filter((d) => Array.isArray(d.contentEmbedding) && d.contentEmbedding.length > 0)
    .map((doc) => ({
      doc,
      score: cosineSimilarity(queryVec, doc.contentEmbedding as number[]),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

export async function syncBlogEmbedding(blogId: string): Promise<void> {
  const blog = await Blog.findById(blogId).select(
    'title excerpt content keywords tags category',
  );
  if (!blog) return;
  const source = blogEmbedSource({
    title: blog.title,
    excerpt: blog.excerpt,
    content: blog.content,
    keywords: blog.keywords,
    tags: blog.tags,
    category: blog.category,
  });
  const contentEmbedding = embedText(source);
  await Blog.updateOne({ _id: blog._id }, { $set: { contentEmbedding } });
}

export async function syncProductEmbedding(productId: string): Promise<void> {
  const p = await Product.findById(productId).select(
    'name shortDescription category fabric tags',
  );
  if (!p) return;
  const source = productEmbedSource({
    name: p.name,
    shortDescription: p.shortDescription,
    category: p.category,
    fabric: p.fabric,
    tags: p.tags,
  });
  const contentEmbedding = embedText(source);
  await Product.updateOne({ _id: p._id }, { $set: { contentEmbedding } });
}

export async function backfillProductEmbeddings(limit = 500): Promise<number> {
  const products = await Product.find({
    isActive: true,
    $or: [
      { contentEmbedding: { $exists: false } },
      { contentEmbedding: { $size: 0 } },
    ],
  })
    .limit(limit)
    .select('_id');

  let n = 0;
  for (const p of products) {
    await syncProductEmbedding(String(p._id));
    n += 1;
  }
  if (n > 0) logger.info(`Synced ${n} product embeddings`);
  return n;
}

export async function backfillBlogEmbeddings(limit = 500): Promise<number> {
  const blogs = await Blog.find({
    $or: [
      { contentEmbedding: { $exists: false } },
      { contentEmbedding: { $size: 0 } },
    ],
  })
    .limit(limit)
    .select('_id');

  let n = 0;
  for (const b of blogs) {
    await syncBlogEmbedding(String(b._id));
    n += 1;
  }
  if (n > 0) logger.info(`Synced ${n} blog embeddings`);
  return n;
}

export async function vectorSearchBlogs(query: string, limit = 5) {
  const queryVec = embedText(query);
  const blogs = await Blog.find({ isPublished: true, contentEmbedding: { $exists: true, $ne: [] } })
    .select('title slug excerpt category tags contentEmbedding viewCount')
    .limit(200)
    .lean();

  return topK(queryVec, blogs, limit).map(({ doc, score }) => ({
    title: doc.title,
    slug: doc.slug,
    excerpt: doc.excerpt,
    category: doc.category,
    tags: doc.tags || [],
    vectorScore: Math.round(score * 1000) / 1000,
  }));
}

export async function vectorSearchProducts(query: string, limit = 6) {
  const queryVec = embedText(query);
  const products = await Product.find({
    isActive: true,
    contentEmbedding: { $exists: true, $ne: [] },
  })
    .select('name slug category fabric tags shortDescription price contentEmbedding')
    .limit(300)
    .lean();

  return topK(queryVec, products, limit).map(({ doc, score }) => ({
    name: doc.name,
    slug: doc.slug,
    category: doc.category,
    fabric: doc.fabric,
    tags: (doc.tags || []).slice(0, 5),
    shortDescription: (doc.shortDescription || '').slice(0, 120),
    priceInr: doc.price,
    vectorScore: Math.round(score * 1000) / 1000,
  }));
}
