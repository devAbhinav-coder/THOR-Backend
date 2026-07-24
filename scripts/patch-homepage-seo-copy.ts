/**
 * One-time patch: replace gifting-heavy homeGiftShowcase copy that Google
 * was using as the homepage snippet instead of meta description.
 *
 * Run: npx ts-node scripts/patch-homepage-seo-copy.ts
 * (from backend/, with MONGODB_URI in env)
 */
import mongoose from "mongoose";
import StorefrontSettings from "../src/models/StorefrontSettings";

const OLD_SNIPPET_MARKERS = [
  "Handmade gifts, corporate gifting, and curated hampers",
  "everything you need for celebrations, clients, and loved ones",
];

const NEW_HOME_GIFT_DESCRIPTION =
  "Also explore handmade gifts, corporate gifting, and curated hampers — perfect alongside our saree, salwar suit, and corset collections.";

const NEW_FOOTER_DESCRIPTION =
  "Your destination for exquisite Indian ethnic wear. Curated sarees, salwar suits, and corsets — crafted with love and tradition.";

async function main() {
  const uri = process.env.MONGODB_URI || process.env.DATABASE_URL;
  if (!uri) {
    console.error("Set MONGODB_URI or DATABASE_URL");
    process.exit(1);
  }
  await mongoose.connect(uri);
  const doc = await StorefrontSettings.findOne().lean();
  if (!doc) {
    console.log("No storefront settings document — defaults apply on next save.");
    await mongoose.disconnect();
    return;
  }

  const settings = doc as {
    homeGiftShowcase?: { description?: string };
    footer?: { description?: string };
  };

  const giftDesc = String(settings.homeGiftShowcase?.description || "");
  const footerDesc = String(settings.footer?.description || "");
  const giftNeedsPatch = OLD_SNIPPET_MARKERS.some((m) => giftDesc.includes(m));
  const footerNeedsPatch =
    !footerDesc.trim() ||
    footerDesc.includes("Handmade gifts") ||
    footerDesc.length < 40;

  if (!giftNeedsPatch && !footerNeedsPatch) {
    console.log("Storefront copy already aligned — no changes.");
    await mongoose.disconnect();
    return;
  }

  const update: Record<string, unknown> = {};
  if (giftNeedsPatch) {
    update["homeGiftShowcase.description"] = NEW_HOME_GIFT_DESCRIPTION;
  }
  if (footerNeedsPatch) {
    update["footer.description"] = NEW_FOOTER_DESCRIPTION;
  }

  await StorefrontSettings.updateOne({}, { $set: update });
  console.log("Patched storefront SEO copy:", update);
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
