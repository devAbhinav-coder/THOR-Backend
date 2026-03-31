import Product from "../models/Product";

export const productRepository = {
  findFeatured() {
    return Product.find({ isFeatured: true, isActive: true, category: { $ne: "Gifting" } })
      .sort("-createdAt")
      .limit(8)
      .select("name slug price comparePrice images ratings category fabric isFeatured");
  },

  findGiftable(filter: Record<string, unknown>, skip: number, limit: number) {
    return Product.find(filter)
      .sort({ isFeatured: -1, createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .select("name slug price comparePrice images category shortDescription tags giftOccasions isFeatured minOrderQty isCustomizable");
  },
};
