/**
 * Migration Phase 1 — Seed SubCategory documents from existing Category data.
 *
 * What this script does:
 *   1. Creates the 4 top-level parent categories: Sarees, Salwar Suits, Corsets, Lehengas
 *   2. For every existing Category document that is NOT a gift category and NOT already
 *      one of the 4 parents, it creates a SubCategory document under "Sarees"
 *      (since all current non-gift categories are saree types).
 *   3. Marks old category documents with _deprecated=false and _migratedToSubcategoryId.
 *
 * SAFE: Additive only. Nothing is deleted or renamed.
 * Run in DRY_RUN=true mode first to preview changes without writing to DB.
 *
 * Usage:
 *   npx ts-node scripts/migrate-phase1-seed-categories.ts
 *   DRY_RUN=true npx ts-node scripts/migrate-phase1-seed-categories.ts
 */

import 'dotenv/config';
import mongoose from 'mongoose';
import Category, { ICategory } from '../src/models/Category';
import SubCategory from '../src/models/SubCategory';

const DRY_RUN = process.env.DRY_RUN === 'true';

async function run() {
  const MONGO_URI = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!MONGO_URI) throw new Error('MONGODB_URI env variable not set');

  await mongoose.connect(MONGO_URI);
  console.log(`[Phase 1] Connected to MongoDB. DRY_RUN=${DRY_RUN}`);

  // ─── Step 1: Ensure 4 top-level parent categories exist ─────────────────────

  const parentDefs = [
    { name: 'Sarees', slug: 'sarees', sortOrder: 0 },
    { name: 'Salwar Suits', slug: 'salwar-suits', sortOrder: 1 },
    { name: 'Corsets', slug: 'corsets', sortOrder: 2 },
    { name: 'Lehengas', slug: 'lehengas', sortOrder: 3 },
  ];

  const parentMap = new Map<string, mongoose.Types.ObjectId>(); // slug → _id

  for (const def of parentDefs) {
    let existing: any = await Category.findOne({ slug: def.slug }).lean();
    if (!existing) {
      if (!DRY_RUN) {
        const created = await Category.create({
          name: def.name,
          slug: def.slug,
          sortOrder: def.sortOrder,
          isActive: true,
          isGiftCategory: false,
          subcategories: [],
        });
        existing = created.toObject();
        console.log(`  ✅ Created parent category: ${def.name} (${def.slug})`);
      } else {
        console.log(`  [DRY RUN] Would create parent category: ${def.name} (${def.slug})`);
        // For dry-run, use a placeholder ObjectId for downstream mapping
        parentMap.set(def.slug, new mongoose.Types.ObjectId());
        continue;
      }
    } else {
      console.log(`  ✓ Parent category already exists: ${def.name} (${def.slug})`);
    }
    parentMap.set(def.slug, existing._id);
  }

  // ─── Step 2: Find all old non-gift, non-parent categories ────────────────────

  const parentSlugs = parentDefs.map((p) => p.slug);
  const oldCategories = await Category.find({
    isGiftCategory: { $ne: true },
    slug: { $nin: parentSlugs },
    _deprecated: { $ne: true },
  }).lean<(ICategory & { _id: mongoose.Types.ObjectId })[]>();

  console.log(`\n[Phase 1] Found ${oldCategories.length} old category documents to migrate.`);

  if (oldCategories.length === 0) {
    console.log('  Nothing to migrate. Exiting.');
    await mongoose.disconnect();
    return;
  }

  const sareesId = parentMap.get('sarees')!;
  const results: { name: string; slug: string; action: string }[] = [];

  for (const oldCat of oldCategories) {
    // Derive subcategory name: "Banarasi Saree" → "Banarasi"
    const subName = oldCat.name
      .replace(/\bsaree\b/gi, '')
      .replace(/\bsarees\b/gi, '')
      .replace(/\bsilk\b/gi, (match) =>
        // Keep "Silk" if it's standalone, it IS the subcategory name
        oldCat.name.toLowerCase().trim() === 'silk saree' || oldCat.name.toLowerCase().trim() === 'silk' ? match : match
      )
      .trim()
      .replace(/\s+/g, ' ')
      || oldCat.name; // fallback: use full name if nothing left after stripping "saree"

    const cleanName = subName || oldCat.name;

    // Check if SubCategory already exists for this old category
    const existingSubcat = await SubCategory.findOne({
      _migratedFromCategoryId: oldCat._id,
    }).lean();

    if (existingSubcat) {
      console.log(`  ⏭ SubCategory already exists for "${oldCat.name}" → skipping`);
      results.push({ name: oldCat.name, slug: oldCat.slug, action: 'skipped (already migrated)' });
      continue;
    }

    if (!DRY_RUN) {
      // Create SubCategory under Sarees (all current non-gift categories are saree types)
      const subcat = await SubCategory.create({
        name: cleanName,
        categoryId: sareesId,
        categorySlug: 'sarees',
        description: oldCat.description,
        image: oldCat.image,
        imagePublicId: (oldCat as any).imagePublicId || undefined,
        isActive: oldCat.isActive,
        sortOrder: 0,
        productCount: oldCat.productCount || 0,
        _migratedFromCategoryId: oldCat._id,
      });

      // Mark old category document as migrated (but do NOT delete or deactivate)
      await Category.updateOne(
        { _id: oldCat._id },
        { $set: { _migratedToSubcategoryId: subcat._id } },
      );

      console.log(
        `  ✅ Created SubCategory: "${cleanName}" (slug: ${subcat.slug}) → from old Category: "${oldCat.name}"`,
      );
      results.push({ name: oldCat.name, slug: subcat.slug, action: `created → ${subcat.slug}` });
    } else {
      console.log(
        `  [DRY RUN] Would create SubCategory: "${cleanName}" from old Category: "${oldCat.name}"`,
      );
      results.push({ name: oldCat.name, slug: '(dry-run)', action: `would create → "${cleanName}"` });
    }
  }

  console.log('\n[Phase 1] Summary:');
  console.table(results);
  console.log(`\n✅ Phase 1 complete. ${DRY_RUN ? '(DRY RUN — nothing written)' : ''}`);

  await mongoose.disconnect();
}

run().catch((err) => {
  console.error('[Phase 1] FATAL:', err);
  process.exit(1);
});
