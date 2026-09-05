/**
 * Seed premium collection products into MongoDB from frontend mock catalog.
 *
 * Usage:
 *   npm run seed:premium-catalog
 *
 * Upserts by premiumSlug — safe to re-run.
 */
import "dotenv/config";
import slugify from "slugify";
import connectDB from "../src/config/db";
import Product from "../src/models/Product";
import { bumpProductCacheVersion } from "../src/services/productCacheService";
import { invalidatePremiumProductCache } from "../src/services/premium/premiumProductDiscoveryService";
import { PREMIUM_PRODUCTS } from "../../frontend/src/lib/premiumCollectionData";

function toImages(urls: string[], name: string) {
  return urls.map((url, i) => ({
    url,
    publicId: `seed/premium/${slugify(name, { lower: true, strict: true })}/${i}`,
    alt: `${name} — image ${i + 1}`,
  }));
}

async function main() {
  await connectDB();
  let upserted = 0;

  for (const [index, item] of PREMIUM_PRODUCTS.entries()) {
    const imageUrls =
      item.images.length > 0 ? item.images : [item.heroImage];
    const images = toImages(imageUrls, item.name);
    const hero = images[0]!;
    const sku = `PREM-${item.slug.toUpperCase().replace(/-/g, "").slice(0, 16)}`;

    const doc = {
      name: item.name,
      slug: `premium-${item.slug}`,
      premiumSlug: item.slug,
      description: item.description,
      shortDescription: item.subtitle,
      premiumSubtitle: item.subtitle,
      price: item.price,
      category: "Premium",
      fabric: item.fabric,
      images,
      premiumHeroImage: hero,
      variants: [
        {
          sku,
          size: "Free",
          color: "Default",
          stock: 5,
          costPrice: Math.round(item.price * 0.45),
        },
      ],
      totalStock: 5,
      tags: ["premium", "premium-edit"],
      isFeatured: false,
      isActive: true,
      isPremium: true,
      isGiftable: false,
      isCustomizable: false,
      craftNote: item.craftNote,
      weaveHours: item.weaveHours,
      premiumEditorialOpen: item.editorialOpen,
      premiumEditorialClose: item.editorialClose,
      sortOrderPremium: index + 1,
      hsnCode: "50072010",
    };

    await Product.findOneAndUpdate(
      { premiumSlug: item.slug },
      { $set: doc },
      { upsert: true, new: true, runValidators: true, setDefaultsOnInsert: true },
    );
    upserted += 1;
    console.log(`✓ ${item.name} (${item.slug})`);
  }

  await bumpProductCacheVersion();
  invalidatePremiumProductCache();
  console.log(`\nDone — ${upserted} premium products upserted.`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
