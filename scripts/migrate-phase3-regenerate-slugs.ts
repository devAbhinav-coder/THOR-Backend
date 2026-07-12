/**
 * Migration Phase 3 — Regenerate product slugs for cleaner URLs.
 *
 * What this script does:
 *   1. For every product, generates a clean slug from the name using slugify.
 *   2. Saves the OLD slug to product.oldSlug (for 301 redirects).
 *   3. Sets the new slug (appends 5-char nanoid on collision).
 *
 * Run after Phase 2. Products already with oldSlug set are skipped.
 *
 * IMPORTANT: After running this, update next.config.js with the redirect map
 * generated at logs/migration-phase3-slug-map.json
 *
 * Usage:
 *   npx ts-node scripts/migrate-phase3-regenerate-slugs.ts
 *   DRY_RUN=true npx ts-node scripts/migrate-phase3-regenerate-slugs.ts
 */

import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';
import mongoose from 'mongoose';
import Product from '../src/models/Product';

// Inline nanoid-like function (no external dep for scripts)
function nanoid(len = 5): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let out = '';
  for (let i = 0; i < len; i++) {
    out += chars[Math.floor(Math.random() * chars.length)];
  }
  return out;
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

const DRY_RUN = process.env.DRY_RUN === 'true';
const BATCH_SIZE = 100; // smaller batch due to sequential slug collision checks

async function run() {
  const MONGO_URI = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!MONGO_URI) throw new Error('MONGODB_URI env variable not set');

  await mongoose.connect(MONGO_URI);
  console.log(`[Phase 3] Connected. DRY_RUN=${DRY_RUN}`);

  // Track all slugs already assigned in this run to catch in-batch collisions
  const usedInRun = new Set<string>();
  const slugMap: { oldSlug: string; newSlug: string; productId: string; name: string }[] = [];

  const total = await Product.countDocuments({ oldSlug: { $exists: false } });
  console.log(`[Phase 3] Products to process: ${total}`);

  let processed = 0;
  let changed = 0;
  let unchanged = 0;

  const cursor = Product.find({ oldSlug: { $exists: false } })
    .select('_id name slug')
    .cursor();

  let batch: any[] = [];

  for await (const product of cursor) {
    processed++;
    const oldSlug = product.slug;
    const baseSlug = slugify(product.name);

    // Check if this is already a clean slug (no timestamp suffix like -1718000000000)
    const hasTimestampSuffix = /-\d{10,}$/.test(oldSlug);
    const needsRegeneration = hasTimestampSuffix || oldSlug !== baseSlug;

    if (!needsRegeneration) {
      // Slug is already clean — just record oldSlug = current slug to avoid re-processing
      if (!DRY_RUN) {
        batch.push({
          updateOne: {
            filter: { _id: product._id },
            update: { $set: { oldSlug: product.slug } },
          },
        });
      }
      unchanged++;
    } else {
      // Generate a new clean slug
      let newSlug = baseSlug;

      // Collision check: against DB and within current batch
      const existsInDb = await Product.exists({
        slug: newSlug,
        _id: { $ne: product._id },
      });

      if (existsInDb || usedInRun.has(newSlug)) {
        newSlug = `${baseSlug}-${nanoid(5)}`;
        // Re-check for very unlikely second collision
        while (
          (await Product.exists({ slug: newSlug, _id: { $ne: product._id } })) ||
          usedInRun.has(newSlug)
        ) {
          newSlug = `${baseSlug}-${nanoid(5)}`;
        }
      }

      usedInRun.add(newSlug);
      slugMap.push({ oldSlug, newSlug, productId: (product._id as mongoose.Types.ObjectId).toString(), name: product.name });

      if (!DRY_RUN) {
        batch.push({
          updateOne: {
            filter: { _id: product._id },
            update: { $set: { slug: newSlug, oldSlug: oldSlug } },
          },
        });
      }
      changed++;
    }

    if (batch.length >= BATCH_SIZE) {
      if (!DRY_RUN) await Product.bulkWrite(batch);
      batch = [];
      console.log(`  Processed ${processed}/${total}...`);
    }
  }

  if (batch.length > 0 && !DRY_RUN) {
    await Product.bulkWrite(batch);
  }

  // Write redirect map
  const logsDir = path.join(__dirname, '..', 'logs');
  if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });

  const slugMapPath = path.join(logsDir, 'migration-phase3-slug-map.json');
  fs.writeFileSync(slugMapPath, JSON.stringify(slugMap, null, 2));

  // Also write a next.config.js-friendly redirects array
  const redirects = slugMap.map(({ oldSlug, newSlug }) => ({
    source: `/shop/${oldSlug}`,
    destination: `/shop/${newSlug}`,
    permanent: true,
  }));
  const redirectsPath = path.join(logsDir, 'migration-phase3-nextjs-redirects.json');
  fs.writeFileSync(redirectsPath, JSON.stringify(redirects, null, 2));

  console.log('\n[Phase 3] Summary:');
  console.log(`  Total processed : ${processed}`);
  console.log(`  Slugs changed   : ${changed}`);
  console.log(`  Slugs unchanged : ${unchanged}`);
  console.log(`  Slug map        : ${slugMapPath}`);
  console.log(`  Next.js redirects: ${redirectsPath}`);
  console.log(`\n  ⚠️  NEXT STEP: Add the redirects from ${redirectsPath} to your next.config.js redirects() function.`);

  if (DRY_RUN) console.log('\n  ⚠️  DRY RUN — no writes performed.');
  else console.log('\n  ✅ Phase 3 complete.');

  await mongoose.disconnect();
}

run().catch((err) => {
  console.error('[Phase 3] FATAL:', err);
  process.exit(1);
});
