/**
 * Sync vector embeddings for blogs + active products (local hashing — no Pinecone).
 * Run: npm run sync:embeddings
 */
import 'dotenv/config';
import connectDB from '../src/config/db';
import {
  backfillBlogEmbeddings,
} from '../src/services/ai/vectorIndexService';
import Product from '../src/models/Product';
import { syncProductEmbedding } from '../src/services/ai/vectorIndexService';

async function main() {
  await connectDB();
  const blogCount = await backfillBlogEmbeddings(2000);

  const products = await Product.find({ isActive: true }).select('_id').limit(2000);
  let productCount = 0;
  for (const p of products) {
    await syncProductEmbedding(String(p._id));
    productCount += 1;
  }

  console.log('Embedding sync complete.', { blogs: blogCount, products: productCount });
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
