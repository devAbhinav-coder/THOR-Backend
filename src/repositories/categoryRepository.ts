import Category, { ICategory } from '../models/Category';
import { buildCategoryProductCountMap } from '../services/categoryProductCountService';

export const categoryRepository = {
  list(filter: Record<string, unknown>) {
    return Category.find(filter)
      .sort({ sortOrder: 1, name: 1 })
      .select('name slug description image imagePublicId heroBannerImage metaTitle metaDescription isActive isGiftCategory giftType minOrderQty sortOrder')
      .lean<ICategory[]>();
  },

  /** Find a single active category by slug. */
  findBySlug(slug: string) {
    return Category.findOne({ slug: slug.toLowerCase(), isActive: true })
      .select('name slug description image imagePublicId heroBannerImage heroBannerPublicId metaTitle metaDescription isActive isGiftCategory giftType minOrderQty sortOrder subcategories')
      .lean<ICategory | null>();
  },

  /** Returns accurate product counts via aggregation (not the stale productCount field). */
  async listWithProductCounts(filter: Record<string, unknown> = {}) {
    const categories = await Category.find({ isActive: true, ...filter })
      .sort({ sortOrder: 1, name: 1 })
      .select('name slug description image imagePublicId isActive isGiftCategory sortOrder')
      .lean<ICategory[]>();

    const countMap = await buildCategoryProductCountMap(categories);

    return categories.map((cat) => ({
      ...cat,
      productCount:
        countMap.get((cat._id as import('mongoose').Types.ObjectId).toString()) ?? 0,
    }));
  },
};

