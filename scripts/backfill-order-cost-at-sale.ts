/**
 * One-time / on-demand: freeze costAtSale on order lines from variant cost (catalog) or 0 (manual).
 * Run: npm run backfill:order-cost-at-sale
 */
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import { backfillOrderCostAtSale } from '../src/services/inventory/inventoryInsightsService';

dotenv.config();

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error('MONGODB_URI missing');
    process.exit(1);
  }
  await mongoose.connect(uri);
  console.log('Connected. Backfilling costAtSale on order lines…');
  const result = await backfillOrderCostAtSale();
  console.log(
    `costAtSale: updated ${result.updatedLines} lines across ${result.updatedOrders} orders.`,
  );
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
