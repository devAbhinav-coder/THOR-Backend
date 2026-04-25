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

  findGiftable(filter: Record<string, unknown>, skip: number, limit: number, customSort?: Record<string, unknown>) {
    const query = Product.find(filter);
    if (filter.$text) {
      query.select({ score: { $meta: "textScore" } });
    }
    const sortParams = customSort || (filter.$text ? { score: { $meta: "textScore" } } : { isFeatured: -1, createdAt: -1 });
    
    return query
      .sort(sortParams as Parameters<typeof query.sort>[0])
      .skip(skip)
      .limit(limit)
      .select("name slug price comparePrice images category description shortDescription tags giftOccasions isFeatured isActive minOrderQty isCustomizable customFields productDetails variants");
  },
};
