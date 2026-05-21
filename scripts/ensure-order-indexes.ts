/**
 * Run once after deploy (production/staging):
 *   npx ts-node --transpile-only scripts/ensure-order-indexes.ts
 *
 * Creates/updates Order + OrderEventOutbox indexes defined in Mongoose schemas.
 * Safe to re-run — syncIndexes only adds missing indexes, does not drop data.
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import connectDB from '../src/config/db';
import Order from '../src/models/Order';
import OrderEventOutbox from '../src/models/OrderEventOutbox';

async function main() {
  await connectDB();
  await Promise.all([Order.syncIndexes(), OrderEventOutbox.syncIndexes()]);
  console.log('Order indexes synchronized.');
  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
