const mongoose = require("mongoose");

async function drop() {
  await mongoose.connect("mongodb://localhost:27017/pia-ecom");
  try {
    await mongoose.connection.collection("products").dropIndex("name_text_description_text_tags_text");
    console.log("Dropped old text index");
  } catch (e) {
    console.log("Index might not exist:", e.message);
  }
  process.exit(0);
}
drop();
