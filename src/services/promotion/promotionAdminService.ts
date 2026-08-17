import mongoose from 'mongoose';
import Promotion from '../../models/Promotion';
import AppError from '../../types/utils/AppError';
import {
  assertPromotionBusinessRules,
  normalizeExpiryDate,
} from './promotionBusinessRules';
import { invalidatePromotionCaches } from './promotionCacheService';

const QUERY_MAX_MS = Number(process.env.PROMOTION_QUERY_MAX_MS || 5000);

const ADMIN_SELECT =
  'name description termsAndConditions displayTitle badgeText imageUrl imagePublicId promotionType buyQuantity getQuantity getDiscountPercent discountValue maxDiscountAmount minOrderAmount scopeType categoryIds subcategoryIds productIds startDate endDate isActive showOnStorefront priority archivedAt createdAt updatedAt';

const ALLOWED_UPDATE = [
  'name',
  'description',
  'termsAndConditions',
  'displayTitle',
  'badgeText',
  'imageUrl',
  'imagePublicId',
  'promotionType',
  'buyQuantity',
  'getQuantity',
  'getDiscountPercent',
  'discountValue',
  'maxDiscountAmount',
  'minOrderAmount',
  'scopeType',
  'categoryIds',
  'subcategoryIds',
  'productIds',
  'startDate',
  'endDate',
  'isActive',
  'showOnStorefront',
  'priority',
] as const;

function assertScope(data: Record<string, unknown>) {
  assertPromotionBusinessRules({
    promotionType: data.promotionType as 'bogo' | 'flat' | 'percentage',
    buyQuantity: data.buyQuantity as number | undefined,
    getQuantity: data.getQuantity as number | undefined,
    getDiscountPercent: data.getDiscountPercent as number | undefined,
    discountValue: data.discountValue as number | undefined,
    startDate: new Date(data.startDate as string),
    endDate: new Date(data.endDate as string),
    scopeType: data.scopeType as
      | 'all'
      | 'categories'
      | 'subcategories'
      | 'products'
      | undefined,
    categoryIds: data.categoryIds as unknown[] | undefined,
    subcategoryIds: data.subcategoryIds as unknown[] | undefined,
    productIds: data.productIds as unknown[] | undefined,
  });
}

export const promotionAdminService = {
  async create(data: Record<string, unknown>) {
    const startDate = new Date(data.startDate as string);
    const endDate = normalizeExpiryDate(new Date(data.endDate as string));
    assertScope({ ...data, startDate, endDate });

    const promotion = await Promotion.create({
      ...data,
      startDate,
      endDate,
    });
    await invalidatePromotionCaches();
    return promotion;
  },

  async list(query: { page?: number; limit?: number }) {
    const filter = { deletedAt: null, archivedAt: null };
    const page = query.page;
    const limit = query.limit;

    if (!page && !limit) {
      const promotions = await Promotion.find(filter)
        .select(ADMIN_SELECT)
        .sort('-priority -createdAt')
        .maxTimeMS(QUERY_MAX_MS)
        .lean();
      return { promotions };
    }

    const safeLimit = Math.min(Math.max(limit ?? 20, 1), 100);
    const safePage = Math.max(page ?? 1, 1);
    const skip = (safePage - 1) * safeLimit;

    const [promotions, total] = await Promise.all([
      Promotion.find(filter)
        .select(ADMIN_SELECT)
        .sort('-priority -createdAt')
        .skip(skip)
        .limit(safeLimit)
        .maxTimeMS(QUERY_MAX_MS)
        .lean(),
      Promotion.countDocuments(filter).maxTimeMS(QUERY_MAX_MS),
    ]);

    return {
      promotions,
      pagination: {
        page: safePage,
        limit: safeLimit,
        total,
        totalPages: Math.ceil(total / safeLimit) || 1,
      },
    };
  },

  async getById(id: string) {
    if (!mongoose.Types.ObjectId.isValid(id)) {
      throw new AppError('Invalid promotion id.', 400);
    }
    const promotion = await Promotion.findOne({
      _id: id,
      deletedAt: null,
      archivedAt: null,
    })
      .select(ADMIN_SELECT)
      .maxTimeMS(QUERY_MAX_MS)
      .lean();
    if (!promotion) throw new AppError('Promotion not found.', 404);
    return promotion;
  },

  buildUpdatePayload(body: Record<string, unknown>): Record<string, unknown> {
    const update: Record<string, unknown> = {};
    for (const field of ALLOWED_UPDATE) {
      if (Object.prototype.hasOwnProperty.call(body, field)) {
        update[field] = body[field];
      }
    }
    if (update.endDate) {
      update.endDate = normalizeExpiryDate(new Date(update.endDate as string));
    }
    if (update.startDate) {
      update.startDate = new Date(update.startDate as string);
    }
    if (
      body.clearImage === true ||
      body.clearImage === 'true' ||
      update.imageUrl === ''
    ) {
      update.imageUrl = '';
      update.imagePublicId = '';
    }
    return update;
  },

  async update(id: string, body: Record<string, unknown>) {
    if (!mongoose.Types.ObjectId.isValid(id)) {
      throw new AppError('Invalid promotion id.', 400);
    }
    const update = this.buildUpdatePayload(body);
    if (Object.keys(update).length === 0) {
      throw new AppError('No valid fields to update.', 400);
    }

    const existing = await Promotion.findOne({ _id: id, deletedAt: null }).lean();
    if (!existing) throw new AppError('Promotion not found.', 404);

    const merged = { ...existing, ...update };
    assertScope({
      ...merged,
      startDate: merged.startDate,
      endDate: merged.endDate,
    });

    const promotion = await Promotion.findOneAndUpdate(
      { _id: id, deletedAt: null, archivedAt: null },
      update,
      { new: true, runValidators: true },
    )
      .select(ADMIN_SELECT)
      .maxTimeMS(QUERY_MAX_MS);

    if (!promotion) throw new AppError('Promotion not found.', 404);
    await invalidatePromotionCaches();
    return promotion;
  },

  async softDelete(id: string) {
    if (!mongoose.Types.ObjectId.isValid(id)) {
      throw new AppError('Invalid promotion id.', 400);
    }
    const promotion = await Promotion.findOneAndUpdate(
      { _id: id, deletedAt: null },
      { $set: { isActive: false, deletedAt: new Date() } },
      { new: true },
    ).select('name');
    if (!promotion) throw new AppError('Promotion not found.', 404);
    await invalidatePromotionCaches();
    return promotion;
  },

  async archive(id: string) {
    if (!mongoose.Types.ObjectId.isValid(id)) {
      throw new AppError('Invalid promotion id.', 400);
    }
    const promotion = await Promotion.findOneAndUpdate(
      { _id: id, deletedAt: null, archivedAt: null },
      { $set: { isActive: false, archivedAt: new Date() } },
      { new: true },
    ).select('name');
    if (!promotion) throw new AppError('Promotion not found.', 404);
    await invalidatePromotionCaches();
    return promotion;
  },

  async previewAffectedCount(body: Record<string, unknown>) {
    const Product = (await import('../../models/Product')).default;
    const scope = (body.scopeType as string) || 'all';
    const filter: Record<string, unknown> = { isActive: true, deletedAt: null };

    if (scope === 'categories' && (body.categoryIds as string[])?.length) {
      filter.categoryId = { $in: body.categoryIds };
    } else if (scope === 'subcategories' && (body.subcategoryIds as string[])?.length) {
      filter.subcategoryId = { $in: body.subcategoryIds };
    } else if (scope === 'products' && (body.productIds as string[])?.length) {
      filter._id = { $in: body.productIds };
    }

    const count = await Product.countDocuments(filter).maxTimeMS(QUERY_MAX_MS);
    return { count };
  },
};
