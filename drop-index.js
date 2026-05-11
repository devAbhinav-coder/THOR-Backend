/**
 * One-off: drop legacy MongoDB text index on products (if present).
 * Usage: from backend/, set MONGODB_URI in .env then: node drop-index.js
 */
require("dotenv").config();
const mongoose = require("mongoose");

async function drop() {
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!uri) {
    console.error("Missing MONGODB_URI (or MONGO_URI). Set it in .env or the environment.");
    process.exit(1);
  }

  await mongoose.connect(uri);
  try {
    await mongoose.connection
      .collection("products")
      .dropIndex("name_text_description_text_tags_text");
    console.log("Dropped old text index");
  } catch (e) {
    console.log("Index might not exist:", e.message);
  }
  await mongoose.disconnect().catch(() => {});
  process.exit(0);
}

drop();
