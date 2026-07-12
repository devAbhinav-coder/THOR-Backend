import { Types } from 'mongoose';
import SubCategory, { ISubCategory } from '../models/SubCategory';

const LIST_SELECT =
  'name slug categoryId categorySlug description image imagePublicId heroBannerImage metaTitle metaDescription isActive sortOrder productCount';

export const subcategoryRepository = {
  /** All active subcategories for a category (by ObjectId) — sorted by sortOrder asc, then name. */
  listByCategoryId(categoryId: Types.ObjectId | string) {
    return SubCategory.find({ categoryId, isActive: true })
      .sort({ sortOrder: 1, name: 1 })
      .select(LIST_SELECT)
      .lean<ISubCategory[]>();
  },

  /** All active subcategories for a category (by slug) — used in navigation lookups. */
  listByCategorySlug(categorySlug: string) {
    return SubCategory.find({ categorySlug: categorySlug.toLowerCase(), isActive: true })
      .sort({ sortOrder: 1, name: 1 })
      .select(LIST_SELECT)
      .lean<ISubCategory[]>();
  },

  /** Find a single subcategory by its own slug (globally unique). */
  findBySlug(slug: string) {
    return SubCategory.findOne({ slug: slug.toLowerCase() })
      .select(LIST_SELECT)
      .lean<ISubCategory | null>();
  },

  /** Find by categorySlug + subcategory slug pair (navigation lookup). */
  findByCategoryAndSlug(categorySlug: string, subSlug: string) {
    return SubCategory.findOne({
      categorySlug: categorySlug.toLowerCase(),
      slug: subSlug.toLowerCase(),
      isActive: true,
    })
      .select(LIST_SELECT)
      .lean<ISubCategory | null>();
  },

  /** All subcategories (admin — includes inactive). */
  listAll(filter: Partial<{ categoryId: string; isActive: boolean }> = {}) {
    const query: Record<string, unknown> = {};
    if (filter.categoryId) query.categoryId = filter.categoryId;
    if (filter.isActive !== undefined) query.isActive = filter.isActive;
    return SubCategory.find(query).sort({ categorySlug: 1, sortOrder: 1, name: 1 }).lean<ISubCategory[]>();
  },

  create(data: Partial<ISubCategory>) {
    return SubCategory.create(data);
  },

  findById(id: string) {
    return SubCategory.findById(id).lean<ISubCategory | null>();
  },

  updateById(id: string, update: Partial<ISubCategory>) {
    return SubCategory.findByIdAndUpdate(id, update, { new: true, runValidators: true }).lean<ISubCategory | null>();
  },

  deleteById(id: string) {
    return SubCategory.findByIdAndDelete(id);
  },

  /** Bulk update sortOrder values — used by admin drag-to-reorder. */
  async bulkReorder(items: { id: string; sortOrder: number }[]) {
    const ops = items.map(({ id, sortOrder }) => ({
      updateOne: {
        filter: { _id: id },
        update: { $set: { sortOrder } },
      },
    }));
    return SubCategory.bulkWrite(ops);
  },

  /** Count products currently associated with a subcategory (for delete guard). */
  countProducts(subcategoryId: string) {
    // Lazy import to avoid circular deps; Product is in the same layer
    const Product = require('../models/Product').default;
    return (Product as import('mongoose').Model<import('../types').IProduct>).countDocuments({
      subcategoryId,
      isActive: true,
    });
  },

  /** Recalculate and update the cached productCount field. */
  async recalculateProductCount(subcategoryId: string) {
    const count = await this.countProducts(subcategoryId);
    return SubCategory.updateOne({ _id: subcategoryId }, { $set: { productCount: count } });
  },
};
