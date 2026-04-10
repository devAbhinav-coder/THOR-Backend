/**
 * One-time: legacy orders with status "delivered" but missing deliveredAt.
 * Priority: last statusHistory entry with status "delivered" → updatedAt → createdAt.
 *
 * Run from backend folder (same .env as app):
 *   npx ts-node --transpile-only scripts/backfill-delivered-at.ts
 *
 * Dry-run (no writes):
 *   npx ts-node --transpile-only scripts/backfill-delivered-at.ts --dry-run
 */

import "dotenv/config";
import mongoose from "mongoose";
import Order from "../src/models/Order";

function inferDeliveredAt(doc: {
  statusHistory?: { status: string; timestamp?: Date }[];
  updatedAt?: Date;
  createdAt?: Date;
}): Date {
  const hist = doc.statusHistory || [];
  const delivered = hist.filter((h) => h.status === "delivered");
  if (delivered.length > 0) {
    const last = delivered[delivered.length - 1];
    if (last.timestamp) return new Date(last.timestamp);
  }
  if (doc.updatedAt) return new Date(doc.updatedAt);
  if (doc.createdAt) return new Date(doc.createdAt);
  return new Date();
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const uri = process.env.MONGODB_URI?.trim();
  if (!uri) {
    console.error("MONGODB_URI is not set.");
    process.exit(1);
  }

  await mongoose.connect(uri);
  console.log("Connected.");

  const filter = {
    status: "delivered",
    $or: [{ deliveredAt: { $exists: false } }, { deliveredAt: null }],
  };

  const cursor = Order.find(filter).cursor();
  let updated = 0;

  for await (const doc of cursor) {
    const at = inferDeliveredAt(doc);
    if (dryRun) {
      console.log(
        `[dry-run] ${doc.orderNumber || doc._id} → deliveredAt would be ${at.toISOString()}`
      );
    } else {
      doc.deliveredAt = at;
      await doc.save();
    }
    updated += 1;
  }

  if (updated === 0) {
    console.log("No matching orders (delivered without deliveredAt).");
  } else {
    console.log(
      dryRun ? `Dry-run: ${updated} order(s) would be updated.` : `Updated ${updated} order(s).`
    );
  }

  await mongoose.disconnect();
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
