/**
 * Admin SubCategory controller.
 * All routes are protected by the admin auth middleware.
 *
 * GET    /api/admin/subcategories              → list all (admin)
 * GET    /api/admin/subcategories/:id          → single by id
 * POST   /api/admin/subcategories              → create
 * PATCH  /api/admin/subcategories/:id          → update
 * DELETE /api/admin/subcategories/:id          → delete (guarded by product count)
 * PATCH  /api/admin/subcategories/reorder      → bulk sortOrder update
 * GET    /api/admin/categories/:id/subcategories → list by parent category
 */

import { Request, Response, NextFunction } from 'express';
import { Types } from 'mongoose';
import catchAsync from '../../types/utils/catchAsync';
import AppError from '../../types/utils/AppError';
import { sendSuccess } from '../../types/utils/response';
import { subcategoryRepository } from '../../repositories/subcategoryRepository';
import { categoryRepository } from '../../repositories/categoryRepository';
import { invalidateMegaMenuCache } from '../navigationController';
import { enqueueImageDelete } from '../../queues/imageQueue';
import { notifyIndexNowStorefront } from '../../services/indexNowService';

// ─── List ─────────────────────────────────────────────────────────────────────

export const listSubcategories = catchAsync(async (req: Request, res: Response) => {
  const filter: { categoryId?: string; isActive?: boolean } = {};
  if (req.query.categoryId) filter.categoryId = String(req.query.categoryId);
  if (req.query.isActive !== undefined) filter.isActive = req.query.isActive === 'true';
  const subcategories = await subcategoryRepository.listAll(filter);
  sendSuccess(res, { subcategories });
});

// ─── Single ───────────────────────────────────────────────────────────────────

export const getSubcategory = catchAsync(async (req: Request, res: Response, next: NextFunction) => {
  const subcat = await subcategoryRepository.findById(req.params.id);
  if (!subcat) return next(new AppError('SubCategory not found', 404));
  sendSuccess(res, { subcategory: subcat });
});

// ─── Create ───────────────────────────────────────────────────────────────────

export const createSubcategory = catchAsync(async (req: Request, res: Response, next: NextFunction) => {
  const {
    name,
    categoryId,
    description,
    metaTitle,
    metaDescription,
    isActive,
    sortOrder,
  } = req.body as {
    name: string;
    categoryId: string;
    description?: string;
    metaTitle?: string;
    metaDescription?: string;
    isActive?: string | boolean;
    sortOrder?: string | number;
  };

  if (!name?.trim()) return next(new AppError('name is required', 400));
  if (!categoryId?.trim()) return next(new AppError('categoryId is required', 400));
  if (!Types.ObjectId.isValid(categoryId)) return next(new AppError('categoryId must be a valid ObjectId', 400));

  // Verify parent category exists
  const parentCat = await categoryRepository.findBySlug('');
  const parentById = await (await import('../../models/Category')).default.findById(categoryId).lean();
  if (!parentById) return next(new AppError('Parent category not found', 404));

  const uploadedImage = (req as any).uploadedImage as { url: string; publicId: string } | undefined;
  const image = uploadedImage?.url;
  const imagePublicId = uploadedImage?.publicId;

  const subcat = await subcategoryRepository.create({
    name: name.trim(),
    categoryId: new Types.ObjectId(categoryId),
    categorySlug: String(parentById.slug || ''),
    description: description?.trim(),
    image,
    imagePublicId,
    metaTitle: metaTitle?.trim(),
    metaDescription: metaDescription?.trim(),
    isActive: isActive === undefined ? true : String(isActive) === 'true',
    sortOrder: sortOrder !== undefined ? Number(sortOrder) : 0,
  });

  // Invalidate mega-menu cache so new subcategory appears immediately
  invalidateMegaMenuCache();

  if (subcat.isActive !== false && subcat.categorySlug && subcat.slug) {
    notifyIndexNowStorefront(
      `/shop/collections/${encodeURIComponent(String(subcat.categorySlug))}/${encodeURIComponent(String(subcat.slug))}`,
    );
  }

  sendSuccess(res, { subcategory: subcat }, 'SubCategory created', 201);
});

// ─── Update ───────────────────────────────────────────────────────────────────

export const updateSubcategory = catchAsync(async (req: Request, res: Response, next: NextFunction) => {
  const subcat = await subcategoryRepository.findById(req.params.id);
  if (!subcat) return next(new AppError('SubCategory not found', 404));

  const update: Record<string, unknown> = {};
  const allowed = ['name', 'description', 'metaTitle', 'metaDescription', 'isActive', 'sortOrder'];
  for (const key of allowed) {
    if (req.body[key] !== undefined) {
      update[key] = req.body[key];
    }
  }
  if (update.isActive !== undefined) update.isActive = String(update.isActive) === 'true';
  if (update.sortOrder !== undefined) update.sortOrder = Number(update.sortOrder);
  if (typeof update.metaTitle === 'string') update.metaTitle = update.metaTitle.trim();
  if (typeof update.metaDescription === 'string') {
    update.metaDescription = update.metaDescription.trim();
  }
  const uploadedImage = (req as any).uploadedImage as { url: string; publicId: string } | undefined;
  if (uploadedImage) {
    update.image = uploadedImage.url;
    update.imagePublicId = uploadedImage.publicId;
    if (subcat.imagePublicId) {
      await enqueueImageDelete([subcat.imagePublicId]);
    }
  }

  const updated = await subcategoryRepository.updateById(req.params.id, update);
  invalidateMegaMenuCache();

  if (updated?.isActive !== false && updated?.categorySlug && updated?.slug) {
    notifyIndexNowStorefront(
      `/shop/collections/${encodeURIComponent(String(updated.categorySlug))}/${encodeURIComponent(String(updated.slug))}`,
    );
  }

  sendSuccess(res, { subcategory: updated }, 'SubCategory updated');
});

// ─── Delete ───────────────────────────────────────────────────────────────────

export const deleteSubcategory = catchAsync(async (req: Request, res: Response, next: NextFunction) => {
  const subcat = await subcategoryRepository.findById(req.params.id);
  if (!subcat) return next(new AppError('SubCategory not found', 404));

  // Guard: do not allow deletion if products are still assigned
  const productCount = await subcategoryRepository.countProducts(req.params.id);
  if (productCount > 0) {
    return next(
      new AppError(
        `Cannot delete: ${productCount} product(s) are assigned to this subcategory. Reassign them first.`,
        400,
      ),
    );
  }

  if (subcat.imagePublicId) {
    await enqueueImageDelete([subcat.imagePublicId]);
  }

  await subcategoryRepository.deleteById(req.params.id);
  invalidateMegaMenuCache();
  res.status(204).end();
});

// ─── Bulk reorder ─────────────────────────────────────────────────────────────

export const reorderSubcategories = catchAsync(async (req: Request, res: Response, next: NextFunction) => {
  const { items } = req.body as { items?: { id: string; sortOrder: number }[] };
  if (!Array.isArray(items) || items.length === 0) {
    return next(new AppError('items[] is required', 400));
  }
  for (const item of items) {
    if (!item.id || typeof item.sortOrder !== 'number') {
      return next(new AppError('Each item must have id and sortOrder (number)', 400));
    }
  }
  await subcategoryRepository.bulkReorder(items);
  invalidateMegaMenuCache();
  sendSuccess(res, {}, 'Subcategories reordered');
});

// ─── List by parent category (from category route) ────────────────────────────

export const listSubcategoriesByCategory = catchAsync(async (req: Request, res: Response, next: NextFunction) => {
  if (!Types.ObjectId.isValid(req.params.id)) {
    return next(new AppError('Invalid category id', 400));
  }
  const subcategories = await subcategoryRepository.listByCategoryId(req.params.id);
  sendSuccess(res, { subcategories });
});
