import Product from "../models/Product";

export const productRepository = {
  findFeatured() {
    // Include `variants` (at least stock) so storefront cards can show correct sold-out state.
    return Product.find({ isFeatured: true, isActive: true, category: { $ne: "Gifting" } })
      .sort("-createdAt")
      .limit(8)
      .select(
        "name slug price comparePrice images ratings category fabric isFeatured variants isCustomizable customFields",
      );
  },

  findGiftable(filter: Record<string, unknown>, skip: number, limit: number) {
    return Product.find(filter)
      .sort({ isFeatured: -1, createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .select("name slug price comparePrice images category description shortDescription tags giftOccasions isFeatured isActive minOrderQty isCustomizable customFields productDetails");
  },
};
