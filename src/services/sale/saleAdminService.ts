import mongoose from 'mongoose';
import SaleCampaign from '../../models/SaleCampaign';
import Product from '../../models/Product';
import AppError from '../../types/utils/AppError';
import { invalidateSaleCaches } from './saleCacheService';
import { normalizeExpiryDate } from '../coupon/couponBusinessRules';

const QUERY_MAX_MS = Number(process.env.SALE_QUERY_MAX_MS || 5000);

const ADMIN_SELECT =
  'name description badgeText discountType discountValue maxDiscountPerItem imageUrl imagePublicId showOnStorefront scopeType categoryIds subcategoryIds productIds startDate endDate isActive archivedAt createdAt updatedAt';

const ALLOWED_UPDATE = [
  'name',
  'description',
  'badgeText',
  'discountType',
  'discountValue',
  'maxDiscountPerItem',
  'imageUrl',
  'imagePublicId',
  'showOnStorefront',
  'scopeType',
  'categoryIds',
  'subcategoryIds',
  'productIds',
  'startDate',
  'endDate',
  'isActive',
] as const;

function assertScope(data: Record<string, unknown>) {
  const scope = (data.scopeType as string) || 'all';
  if (scope === 'categories' && !(data.categoryIds as unknown[] | undefined)?.length) {
    throw new AppError('Select at least one category', 400);
  }
  if (scope === 'subcategories' && !(data.subcategoryIds as unknown[] | undefined)?.length) {
    throw new AppError('Select at least one subcategory', 400);
  }
  if (scope === 'products' && !(data.productIds as unknown[] | undefined)?.length) {
    throw new AppError('Select at least one product', 400);
  }
  if (data.discountType === 'percentage' && Number(data.discountValue) > 100) {
    throw new AppError('Percentage discount cannot exceed 100', 400);
  }
}

export const saleAdminService = {
  async create(data: Record<string, unknown>) {
    const startDate = new Date(data.startDate as string);
    const endDate = normalizeExpiryDate(new Date(data.endDate as string));
    if (!(endDate > startDate)) {
      throw new AppError('End date must be after start date', 400);
    }
    assertScope(data);
    const campaign = await SaleCampaign.create({
      ...data,
      startDate,
      endDate,
    });
    await invalidateSaleCaches();
    return campaign;
  },

  async list(query: { page?: number; limit?: number }) {
    const filter = { deletedAt: null, archivedAt: null };
    const page = query.page;
    const limit = query.limit;

    if (!page && !limit) {
      const campaigns = await SaleCampaign.find(filter)
        .select(ADMIN_SELECT)
        .sort('-createdAt')
        .maxTimeMS(QUERY_MAX_MS)
        .lean();
      return { campaigns };
    }

    const safeLimit = Math.min(Math.max(limit ?? 20, 1), 100);
    const safePage = Math.max(page ?? 1, 1);
    const skip = (safePage - 1) * safeLimit;

    const [campaigns, total] = await Promise.all([
      SaleCampaign.find(filter)
        .select(ADMIN_SELECT)
        .sort('-createdAt')
        .skip(skip)
        .limit(safeLimit)
        .maxTimeMS(QUERY_MAX_MS)
        .lean(),
      SaleCampaign.countDocuments(filter).maxTimeMS(QUERY_MAX_MS),
    ]);

    return {
      campaigns,
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
      throw new AppError('Invalid sale id.', 400);
    }
    const campaign = await SaleCampaign.findOne({
      _id: id,
      deletedAt: null,
      archivedAt: null,
    })
      .select(ADMIN_SELECT)
      .maxTimeMS(QUERY_MAX_MS)
      .lean();
    if (!campaign) throw new AppError('Sale campaign not found.', 404);
    return campaign;
  },

  async update(id: string, body: Record<string, unknown>) {
    if (!mongoose.Types.ObjectId.isValid(id)) {
      throw new AppError('Invalid sale id.', 400);
    }
    const update: Record<string, unknown> = {};
    for (const field of ALLOWED_UPDATE) {
      if (Object.prototype.hasOwnProperty.call(body, field)) {
        update[field] = body[field];
      }
    }
    if (update.startDate) update.startDate = new Date(update.startDate as string);
    if (update.endDate) {
      update.endDate = normalizeExpiryDate(new Date(update.endDate as string));
    }
    if (Object.keys(update).length === 0) {
      throw new AppError('At least one field is required', 400);
    }
    assertScope({ ...update, scopeType: update.scopeType ?? 'all' });

    const campaign = await SaleCampaign.findOneAndUpdate(
      { _id: id, deletedAt: null, archivedAt: null },
      update,
      { new: true, runValidators: true }
    )
      .select(ADMIN_SELECT)
      .maxTimeMS(QUERY_MAX_MS);

    if (!campaign) throw new AppError('Sale campaign not found.', 404);
    await invalidateSaleCaches();
    return campaign;
  },

  async softDelete(id: string) {
    if (!mongoose.Types.ObjectId.isValid(id)) {
      throw new AppError('Invalid sale id.', 400);
    }
    const campaign = await SaleCampaign.findOneAndUpdate(
      { _id: id, deletedAt: null },
      { $set: { isActive: false, deletedAt: new Date() } },
      { new: true }
    ).select('name');
    if (!campaign) throw new AppError('Sale campaign not found.', 404);
    await invalidateSaleCaches();
    return campaign;
  },

  async archive(id: string) {
    if (!mongoose.Types.ObjectId.isValid(id)) {
      throw new AppError('Invalid sale id.', 400);
    }
    const campaign = await SaleCampaign.findOneAndUpdate(
      { _id: id, deletedAt: null },
      { $set: { archivedAt: new Date(), isActive: false } },
      { new: true }
    ).select(ADMIN_SELECT);
    if (!campaign) throw new AppError('Sale campaign not found.', 404);
    await invalidateSaleCaches();
    return campaign;
  },

  async previewAffectedCount(body: {
    scopeType?: string;
    categoryIds?: string[];
    subcategoryIds?: string[];
    productIds?: string[];
  }) {
    const scope = body.scopeType || 'all';
    const filter: Record<string, unknown> = { isActive: true };
    if (scope === 'categories') {
      filter.categoryId = {
        $in: (body.categoryIds || []).map((id) => new mongoose.Types.ObjectId(id)),
      };
    } else if (scope === 'subcategories') {
      filter.subcategoryId = {
        $in: (body.subcategoryIds || []).map((id) => new mongoose.Types.ObjectId(id)),
      };
    } else if (scope === 'products') {
      filter._id = {
        $in: (body.productIds || []).map((id) => new mongoose.Types.ObjectId(id)),
      };
    }
    const count = await Product.countDocuments(filter).maxTimeMS(QUERY_MAX_MS);
    return { count };
  },

  async listPublicStorefront() {
    const now = new Date();
    const campaigns = await SaleCampaign.find({
      deletedAt: null,
      archivedAt: null,
      isActive: true,
      showOnStorefront: { $ne: false },
      startDate: { $lte: now },
      endDate: { $gte: now },
    })
      .select(
        'name description badgeText discountType discountValue imageUrl startDate endDate scopeType'
      )
      .sort('-createdAt')
      .limit(24)
      .maxTimeMS(QUERY_MAX_MS)
      .lean();

    return campaigns.map((c) => ({
      _id: String(c._id),
      name: c.name,
      description: c.description,
      badgeText: c.badgeText || 'Sale',
      discountType: c.discountType,
      discountValue: c.discountValue,
      imageUrl: c.imageUrl || null,
      startDate: c.startDate,
      endDate: c.endDate,
      scopeType: c.scopeType || 'all',
    }));
  },
};
