/**
 * Migration Phase 2 — Backfill Product.categoryId and Product.subcategoryId.
 *
 * What this script does:
 *   1. Builds a lookup map: old Category name → { categoryId (Sarees), subcategoryId (Banarasi) }
 *   2. For every Product, matches product.category string → categoryId
 *      and product.subcategory string → subcategoryId
 *   3. Uses bulkWrite in batches of 500 to set the FK fields.
 *   4. Logs all unmatched products to logs/migration-phase2-unmatched.json
 *
 * SAFE: Additive only. Does not modify product.category or product.subcategory strings.
 * Run after Phase 1 has completed successfully.
 *
 * Usage:
 *   npx ts-node scripts/migrate-phase2-backfill-products.ts
 *   DRY_RUN=true npx ts-node scripts/migrate-phase2-backfill-products.ts
 */

import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';
import mongoose from 'mongoose';
import Category, { ICategory } from '../src/models/Category';
import SubCategory, { ISubCategory } from '../src/models/SubCategory';
import Product from '../src/models/Product';

const DRY_RUN = process.env.DRY_RUN === 'true';
const BATCH_SIZE = 500;

async function run() {
  const MONGO_URI = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!MONGO_URI) throw new Error('MONGODB_URI env variable not set');

  await mongoose.connect(MONGO_URI);
  console.log(`[Phase 2] Connected to MongoDB. DRY_RUN=${DRY_RUN}`);

  // ─── Step 1: Build lookup maps ───────────────────────────────────────────────

  // Map: old category name (lowercase) → new parent categoryId (Sarees ObjectId)
  const oldCatToParentId = new Map<string, mongoose.Types.ObjectId>();
  // Map: old category name (lowercase) → subcategoryId (e.g. Banarasi ObjectId)
  const oldCatToSubcatId = new Map<string, mongoose.Types.ObjectId>();
  // Map: subcategory string (lowercase) → subcategoryId (direct match)
  const subcatStringToId = new Map<string, mongoose.Types.ObjectId>();

  // Load all SubCategory documents with their _migratedFromCategoryId
  const subcats = await SubCategory.find({}).lean<(ISubCategory & { _id: mongoose.Types.ObjectId })[]>();

  // Load all Category documents (old ones)
  const allCategories = await Category.find({}).lean<(ICategory & { _id: mongoose.Types.ObjectId })[]>();
  const oldCatMap = new Map(allCategories.map((c) => [c._id.toString(), c]));

  // Find the 4 parent categories
  const sareesCat = allCategories.find((c) => c.slug === 'sarees');
  const salwarCat = allCategories.find((c) => c.slug === 'salwar-suits');
  const corsetCat = allCategories.find((c) => c.slug === 'corsets');
  const lehengaCat = allCategories.find((c) => c.slug === 'lehengas');

  if (!sareesCat) {
    throw new Error('Sarees parent category not found. Run Phase 1 first.');
  }

  // Build lookup: SubCategory._migratedFromCategoryId → { subcategoryId, categoryId }
  for (const subcat of subcats) {
    // Direct subcategory name match (e.g. product.subcategory = "Banarasi")
    subcatStringToId.set(subcat.name.toLowerCase(), subcat._id);

    if (subcat._migratedFromCategoryId) {
      const oldCat = oldCatMap.get(subcat._migratedFromCategoryId.toString());
      if (oldCat) {
        // Old category name match (e.g. product.category = "Banarasi Saree")
        oldCatToParentId.set(oldCat.name.toLowerCase(), subcat.categoryId as mongoose.Types.ObjectId);
        oldCatToSubcatId.set(oldCat.name.toLowerCase(), subcat._id);
      }
    }
  }

  // Also map parent category names directly
  if (sareesCat) oldCatToParentId.set('sarees', sareesCat._id);
  if (salwarCat) oldCatToParentId.set('salwar suits', salwarCat._id);
  if (salwarCat) oldCatToParentId.set('salwar-suits', salwarCat._id);
  if (corsetCat) oldCatToParentId.set('corsets', corsetCat._id);
  if (lehengaCat) oldCatToParentId.set('lehengas', lehengaCat._id);

  console.log(`[Phase 2] Lookup maps built. ${oldCatToParentId.size} category mappings, ${subcatStringToId.size} subcategory mappings.`);

  // ─── Step 2: Find all products that still need backfilling ──────────────────

  const totalProducts = await Product.countDocuments({
    $or: [
      { categoryId: { $exists: false } },
      { categoryId: null },
    ],
  });

  console.log(`[Phase 2] Products needing backfill: ${totalProducts}`);

  let processed = 0;
  let updated = 0;
  let skipped = 0;
  const unmatched: { productId: string; name: string; category: string; subcategory?: string }[] = [];

  // ─── Step 3: Process in batches ─────────────────────────────────────────────

  let cursor = Product.find({
    $or: [{ categoryId: { $exists: false } }, { categoryId: null }],
  }).select('_id name category subcategory categoryId subcategoryId').cursor();

  let batch: any[] = [];

  for await (const product of cursor) {
    processed++;
    const catKey = (product.category || '').toLowerCase().trim();
    const subKey = (product.subcategory || '').toLowerCase().trim();

    const parentId = oldCatToParentId.get(catKey) || sareesCat._id; // default to Sarees
    const subcatId = oldCatToSubcatId.get(catKey) || (subKey ? subcatStringToId.get(subKey) : undefined);

    if (!oldCatToParentId.has(catKey) && catKey) {
      unmatched.push({
        productId: (product._id as mongoose.Types.ObjectId).toString(),
        name: product.name,
        category: product.category,
        subcategory: product.subcategory,
      });
      skipped++;
    }

    const updateFields: Record<string, unknown> = { categoryId: parentId };
    if (subcatId) updateFields.subcategoryId = subcatId;

    batch.push({
      updateOne: {
        filter: { _id: product._id },
        update: { $set: updateFields },
      },
    });

    if (batch.length >= BATCH_SIZE) {
      if (!DRY_RUN) {
        await Product.bulkWrite(batch);
      }
      updated += batch.length;
      batch = [];
      console.log(`  Processed ${processed}/${totalProducts}...`);
    }
  }

  // Process remaining batch
  if (batch.length > 0) {
    if (!DRY_RUN) {
      await Product.bulkWrite(batch);
    }
    updated += batch.length;
  }

  // ─── Step 4: Write unmatched log ────────────────────────────────────────────

  const logsDir = path.join(__dirname, '..', 'logs');
  if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });
  const logPath = path.join(logsDir, 'migration-phase2-unmatched.json');
  fs.writeFileSync(logPath, JSON.stringify(unmatched, null, 2));

  console.log('\n[Phase 2] Summary:');
  console.log(`  Total processed : ${processed}`);
  console.log(`  Updated         : ${updated}`);
  console.log(`  Unmatched/logged: ${skipped}`);
  console.log(`  Unmatched log   : ${logPath}`);

  if (DRY_RUN) {
    console.log('\n  ⚠️  DRY RUN — no writes performed.');
  } else {
    console.log('\n  ✅ Phase 2 complete.');
  }

  if (unmatched.length > 0) {
    console.warn(`\n  ⚠️  ${unmatched.length} products had no category mapping. Review: ${logPath}`);
  }

  await mongoose.disconnect();
}

run().catch((err) => {
  console.error('[Phase 2] FATAL:', err);
  process.exit(1);
});
