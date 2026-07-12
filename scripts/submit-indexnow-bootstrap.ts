/**
 * One-time bootstrap: submit all active storefront URLs to IndexNow (Bing).
 * Usage: npm run indexnow:bootstrap (from backend/, with MONGODB_URI + INDEXNOW_API_KEY set)
 */
import "dotenv/config";
import mongoose from "mongoose";
import Product from "../src/models/Product";
import Blog from "../src/models/Blog";
import Category from "../src/models/Category";
import SubCategory from "../src/models/SubCategory";
import { notifyIndexNowAsync } from "../src/services/indexNowService";

async function main() {
  const uri = process.env.MONGODB_URI?.trim();
  if (!uri) {
    console.error("MONGODB_URI is required");
    process.exit(1);
  }
  const key =
    process.env.INDEXNOW_API_KEY?.trim() ||
    process.env.NEXT_PUBLIC_INDEXNOW_API_KEY?.trim();
  if (!key) {
    console.error("INDEXNOW_API_KEY is required");
    process.exit(1);
  }

  await mongoose.connect(uri);

  const paths: string[] = [
    "/",
    "/shop/collections",
    "/gifting",
    "/blog",
    "/about",
    "/faq",
    "/shipping",
    "/returns",
    "/terms",
    "/privacy",
  ];

  const [products, blogs, categories, subcategories] = await Promise.all([
    Product.find({ isActive: true }).select("slug").lean(),
    Blog.find({ isPublished: true }).select("slug").lean(),
    Category.find({ isActive: true }).select("slug").lean(),
    SubCategory.find({ isActive: true }).select("slug categorySlug").lean(),
  ]);

  for (const p of products) {
    if (p.slug) paths.push(`/shop/${encodeURIComponent(String(p.slug))}`);
  }
  for (const b of blogs) {
    if (b.slug) paths.push(`/blog/${encodeURIComponent(String(b.slug))}`);
  }
  for (const c of categories) {
    if (c.slug) {
      paths.push(`/shop/collections/${encodeURIComponent(String(c.slug))}`);
    }
  }
  for (const s of subcategories) {
    if (s.slug && s.categorySlug) {
      paths.push(
        `/shop/collections/${encodeURIComponent(String(s.categorySlug))}/${encodeURIComponent(String(s.slug))}`,
      );
    }
  }

  console.log(`Submitting ${paths.length} URLs to IndexNow…`);
  await notifyIndexNowAsync(paths);
  console.log("IndexNow batch submitted. Verify in Bing Webmaster Tools → IndexNow.");

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
