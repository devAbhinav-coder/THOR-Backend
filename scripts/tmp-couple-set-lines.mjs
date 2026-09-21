import "dotenv/config";
import mongoose from "mongoose";
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const Order = require("../dist/models/Order.js").default;

const PRODUCT_ID = new mongoose.Types.ObjectId("6a82fba009db90a9bc74cafe");

await mongoose.connect(process.env.MONGODB_URI);

const lines = await Order.aggregate([
  { $match: { paymentStatus: "paid", "items.product": PRODUCT_ID } },
  { $unwind: "$items" },
  { $match: { "items.product": PRODUCT_ID } },
  {
    $project: {
      orderNumber: 1,
      createdAt: 1,
      qty: "$items.quantity",
      unitPrice: "$items.price",
      lineTotal: { $multiply: ["$items.price", "$items.quantity"] },
      name: "$items.name",
      sku: "$items.variant.sku",
    },
  },
  { $sort: { createdAt: -1 } },
]);

let totalQty = 0;
let totalRev = 0;
const byPrice = new Map();
for (const l of lines) {
  totalQty += l.qty;
  totalRev += l.lineTotal;
  const k = l.unitPrice;
  byPrice.set(k, (byPrice.get(k) || 0) + l.qty);
}
console.log("Paid lines:", lines.length);
console.log("Total qty:", totalQty, "Total revenue:", Math.round(totalRev));
console.log("Qty by unit price:", Object.fromEntries(byPrice));
console.log("Sample names:", [...new Set(lines.map((l) => l.name))].slice(0, 3));
console.log("Last 5 lines:", JSON.stringify(lines.slice(0, 5), null, 2));

await mongoose.disconnect();
