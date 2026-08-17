/**
 * One-time / on-demand: backfill variant.soldCount from paid order history.
 * Run: npm run backfill:variant-sold-count
 */
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import { backfillVariantSoldCounts, backfillOfflineLineCategories, backfillOfflineManualLineImages } from '../src/services/inventory/inventoryInsightsService';
import { getOrCreateOfflineManualProduct } from '../src/services/offlineManualProductService';

dotenv.config();

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error('MONGODB_URI missing');
    process.exit(1);
  }
  await mongoose.connect(uri);
  console.log('Sanitizing offline system placeholder product…');
  await getOrCreateOfflineManualProduct();
  console.log('Connected. Backfilling variant soldCount from paid orders…');
  const sold = await backfillVariantSoldCounts();
  console.log(`Variant soldCount: updated ${sold.updated} products.`);
  const cats = await backfillOfflineLineCategories();
  console.log(`Offline line categories: updated ${cats.updated} orders.`);
  const imgs = await backfillOfflineManualLineImages();
  console.log(`Offline line images: updated ${imgs.updated} orders.`);
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
