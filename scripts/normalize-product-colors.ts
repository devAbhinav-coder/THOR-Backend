/**
 * Normalize duplicate color spellings on products (variants + images).
 *
 * Merges case/spacing variants like "Off White" / "Offwhite" / "yellow" / "Yellow"
 * into one canonical Title Case label per match-key.
 * Also strips trailing/leading whitespace that creates false duplicates.
 *
 * Run: npx ts-node --transpile-only scripts/normalize-product-colors.ts
 */
import "dotenv/config";
import mongoose from "mongoose";
import connectDB from "../src/config/db";
import Product from "../src/models/Product";
import {
  catalogMatchKey,
  dedupeCatalogLabels,
  resolveColorAgainstCatalog,
} from "../src/utils/catalogAttributes";
import { invalidateProductCaches } from "../src/services/productCacheService";

async function main() {
  await connectDB();

  const products = await Product.find({})
    .select("_id slug name variants images")
    .lean();

  const allRawColors: string[] = [];
  for (const product of products) {
    for (const v of product.variants || []) {
      if (v.color) allRawColors.push(String(v.color));
    }
    for (const img of product.images || []) {
      if (img.color) allRawColors.push(String(img.color));
    }
  }

  const catalog = dedupeCatalogLabels(allRawColors);
  console.log(`Canonical colors (${catalog.length}):`, catalog.join(", "));

  let updatedProducts = 0;
  let changedFields = 0;

  for (const product of products) {
    let dirty = false;
    const variants = (product.variants || []).map((v) => {
      const original = String(v.color ?? "");
      if (!original.trim()) {
        if (original !== "") {
          dirty = true;
          changedFields += 1;
          return { ...v, color: "" };
        }
        return v;
      }
      const next = resolveColorAgainstCatalog(original, catalog);
      // Compare to original (not trimmed) so "Yellow " → "Yellow" is written.
      if (next !== original) {
        dirty = true;
        changedFields += 1;
        return { ...v, color: next };
      }
      return v;
    });

    const images = (product.images || []).map((img) => {
      const original = String(img.color ?? "");
      if (!original.trim()) {
        if (original !== "") {
          dirty = true;
          changedFields += 1;
          return { ...img, color: "" };
        }
        return img;
      }
      const next = resolveColorAgainstCatalog(original, catalog);
      if (next !== original) {
        dirty = true;
        changedFields += 1;
        return { ...img, color: next };
      }
      return img;
    });

    if (!dirty) continue;

    await Product.updateOne(
      { _id: product._id },
      { $set: { variants, images } },
    );
    updatedProducts += 1;
    console.log(`Updated ${product.slug || product._id}`);
  }

  await invalidateProductCaches();

  const after = await Product.aggregate<{ colors: string[] }>([
    { $unwind: "$variants" },
    { $match: { "variants.color": { $exists: true, $ne: "" } } },
    { $group: { _id: null, colors: { $addToSet: "$variants.color" } } },
  ]);
  const remaining = (after[0]?.colors ?? []).sort();
  const keys = new Set(remaining.map((c) => catalogMatchKey(c)));

  const byKey = new Map<string, string[]>();
  for (const c of remaining) {
    const k = catalogMatchKey(c);
    byKey.set(k, [...(byKey.get(k) || []), c]);
  }
  for (const [k, vals] of byKey) {
    if (vals.length > 1) console.log("STILL DUP", k, vals);
  }

  console.log("Color normalize complete.", {
    updatedProducts,
    changedFields,
    remainingLabels: remaining.length,
    uniqueKeys: keys.size,
    colors: remaining,
  });

  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
