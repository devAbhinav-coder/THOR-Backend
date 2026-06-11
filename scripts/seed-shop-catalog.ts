/**
 * Seed 40 shop-catalog saree products with images, categories, and fabrics.
 *
 * Usage:
 *   npm run seed:shop-catalog
 *   npm run seed:shop-catalog -- --fresh-shop   # remove ALL non-gift shop products first
 *
 * Requires MONGODB_URI in env (loads backend/.env via dotenv).
 */
import "dotenv/config";
import mongoose from "mongoose";
import slugify from "slugify";
import connectDB from "../src/config/db";
import Product from "../src/models/Product";
import Category from "../src/models/Category";
import { OFFLINE_MANUAL_PRODUCT_TAG } from "../src/constants/offlineOrder";
import { bumpProductCacheVersion } from "../src/services/productCacheService";
import {
  SHOP_CATALOG_FABRICS,
  SHOP_CATALOG_SEED_IMAGES,
  SHOP_CATALOG_SEED_TAG,
  SHOP_CATALOG_TARGET_COUNT,
} from "./data/shopCatalogSeedImages";

const COLOR_NAMES = [
  "Ivory Gold",
  "Royal Maroon",
  "Midnight Navy",
  "Emerald Green",
  "Blush Pink",
  "Sunset Orange",
  "Wine Red",
  "Champagne",
  "Teal Blue",
  "Antique Gold",
];

const ADJECTIVES = [
  "Handwoven",
  "Artisan",
  "Heritage",
  "Festive",
  "Bridal",
  "Everyday",
  "Luxury",
  "Classic",
  "Contemporary",
  "Timeless",
];

function isGiftCategoryName(name: string): boolean {
  const n = name.toLowerCase();
  return n.includes("gift") || n.includes("gifting") || n.includes("hamper");
}

function pickImage(index: number) {
  const url = SHOP_CATALOG_SEED_IMAGES[index % SHOP_CATALOG_SEED_IMAGES.length];
  return {
    url,
    publicId: `seed/shop-catalog/${index + 1}`,
    alt: `Seeded saree product image ${index + 1}`,
  };
}

function buildProductDoc(
  index: number,
  category: string,
  fabric: string,
) {
  const adj = ADJECTIVES[index % ADJECTIVES.length];
  const color = COLOR_NAMES[index % COLOR_NAMES.length];
  const name = `${adj} ${fabric} ${category.replace(/sarees?/i, "").trim()} Saree — ${color}`.replace(
    /\s+/g,
    " ",
  );
  const basePrice = 899 + (index % 12) * 750 + (index % 3) * 111;
  const price = Math.min(9999, Math.max(499, basePrice));
  const comparePrice =
    index % 4 === 0 ? Math.min(12999, price + 1200 + (index % 5) * 200) : undefined;
  const ratingAverage = 3.5 + (index % 3) * 0.5;
  const ratingCount = index % 6 === 0 ? 0 : 4 + (index % 18);
  const stock = 8 + (index % 20);
  const slug = `${slugify(name, { lower: true, strict: true })}-seed-${String(index + 1).padStart(2, "0")}`;

  return {
    name,
    slug,
    description: `<p>Elegant ${fabric.toLowerCase()} ${category.toLowerCase()} crafted for celebrations and everyday grace. Soft drape, rich texture, and a refined finish make this a versatile addition to your wardrobe.</p>`,
    shortDescription: `${adj} ${fabric} saree in ${color.toLowerCase()} — premium ethnic wear from The House of Rani.`,
    price,
    comparePrice,
    category,
    subcategory: category,
    fabric,
    images: [pickImage(index)],
    variants: [
      {
        size: "Free Size",
        color,
        stock: 8 + (index % 20),
        sku: `SEED-${String(index + 1).padStart(3, "0")}`,
      },
    ],
    totalStock: stock,
    tags: [SHOP_CATALOG_SEED_TAG, "saree", fabric.toLowerCase()],
    isFeatured: index % 8 === 0,
    isActive: true,
    isGiftable: false,
    ratings: {
      average: ratingCount > 0 ? ratingAverage : 0,
      count: ratingCount,
    },
    soldCount: index % 9,
    viewCount: 10 + index * 3,
  };
}

async function loadShopCategories(): Promise<string[]> {
  const categories = await Category.find({ isActive: true }).lean();
  const names = categories
    .map((c) => String(c.name || "").trim())
    .filter(Boolean)
    .filter((name) => !isGiftCategoryName(name))
    .filter((name) => name.toLowerCase() !== "gifting");

  if (names.length) return names.sort();

  const fallback = [
    "Chanderi Sarees",
    "Cotton Sarees",
    "Jacquard Sarees",
    "Banarasi Sarees",
    "Silk Sarees",
  ];
  for (const name of fallback) {
    await Category.findOneAndUpdate(
      { name },
      { name, isActive: true, subcategories: [] },
      { upsert: true, new: true },
    );
  }
  return fallback;
}

async function deleteShopProducts(mode: "seed-only" | "fresh-shop") {
  if (mode === "fresh-shop") {
    const result = await Product.deleteMany({
      isActive: true,
      category: { $ne: "Gifting" },
      tags: { $nin: [OFFLINE_MANUAL_PRODUCT_TAG] },
    });
    return result.deletedCount ?? 0;
  }

  const result = await Product.deleteMany({
    tags: SHOP_CATALOG_SEED_TAG,
  });
  return result.deletedCount ?? 0;
}

async function main() {
  const freshShop = process.argv.includes("--fresh-shop");
  await connectDB();

  const categories = await loadShopCategories();
  if (!categories.length) {
    throw new Error("No shop categories available for seeding.");
  }

  const removed = await deleteShopProducts(freshShop ? "fresh-shop" : "seed-only");
  console.log(`Removed ${removed} existing product(s).`);

  const docs = Array.from({ length: SHOP_CATALOG_TARGET_COUNT }, (_, i) => {
    const category = categories[i % categories.length];
    const fabric = SHOP_CATALOG_FABRICS[i % SHOP_CATALOG_FABRICS.length];
    return buildProductDoc(i, category, fabric);
  });

  const created = await Product.insertMany(docs, { ordered: true });
  await bumpProductCacheVersion();

  const totalShop = await Product.countDocuments({
    isActive: true,
    category: { $ne: "Gifting" },
    tags: { $nin: [OFFLINE_MANUAL_PRODUCT_TAG] },
  });

  console.log("Shop catalog seed complete.");
  console.log({
    created: created.length,
    categoriesUsed: categories.length,
    fabricsUsed: SHOP_CATALOG_FABRICS.length,
    totalActiveShopProducts: totalShop,
    seedTag: SHOP_CATALOG_SEED_TAG,
  });

  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error(err);
  try {
    await mongoose.disconnect();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
