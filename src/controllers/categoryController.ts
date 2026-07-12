import { Request, Response, NextFunction } from "express";
import Category from "../models/Category";
import Product from "../models/Product";
import catchAsync from "../types/utils/catchAsync";
import AppError from "../types/utils/AppError";
import { sendSuccess } from "../types/utils/response";
import { categoryRepository } from "../repositories/categoryRepository";
import { subcategoryRepository } from "../repositories/subcategoryRepository";
import { enqueueImageDelete } from "../queues/imageQueue";
import { buildCategoryProductCountMap } from "../services/categoryProductCountService";
import { notifyIndexNowStorefront } from "../services/indexNowService";


// GET /api/categories — public
export const getAllCategories = catchAsync(
  async (req: Request, res: Response) => {
    const filter: Record<string, unknown> = {};
    if (req.query.active !== "false") filter.isActive = true;

    const categories = await categoryRepository.list(filter);
    sendSuccess(res, { categories });
  },
);

// GET /api/categories/stats — public — returns categories with real product counts
export const getCategoryStats = catchAsync(
  async (_req: Request, res: Response) => {
    const categories = await Category.find({ isActive: true })
      .sort({ name: 1 })
      .lean();

    const countMap = await buildCategoryProductCountMap(categories);

    const result = categories.map((cat) => ({
      ...cat,
      productCount: countMap.get(String(cat._id)) || 0,
    }));

    sendSuccess(res, { categories: result });
  },
);

// GET /api/categories/:id — public (legacy, by ObjectId)
export const getCategory = catchAsync(
  async (req: Request, res: Response, next: NextFunction) => {
    const cat = await Category.findById(req.params.id);
    if (!cat) return next(new AppError("Category not found", 404));
    sendSuccess(res, { category: cat });
  },
);

// GET /api/categories/slug/:slug — public (new, by slug)
export const getCategoryBySlug = catchAsync(
  async (req: Request, res: Response, next: NextFunction) => {
    const cat = await categoryRepository.findBySlug(req.params.slug);
    if (!cat) return next(new AppError("Category not found", 404));
    sendSuccess(res, { category: cat });
  },
);

// GET /api/categories/slug/:slug/subcategories — public
export const getCategorySubcategories = catchAsync(
  async (req: Request, res: Response, next: NextFunction) => {
    const cat = await categoryRepository.findBySlug(req.params.slug);
    if (!cat) return next(new AppError("Category not found", 404));
    const subcategories = await subcategoryRepository.listByCategorySlug(req.params.slug);
    sendSuccess(res, { subcategories, category: { _id: cat._id, name: cat.name, slug: cat.slug } });
  },
);


function parseSubcategories(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.map(String).filter(Boolean);
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed.map(String).filter(Boolean);
    } catch {
      // comma-separated fallback
      return raw
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
    }
  }
  return [];
}

// POST /api/admin/categories — admin only
export const createCategory = catchAsync(
  async (req: Request, res: Response) => {
    const {
      name,
      description,
      subcategories,
      isActive,
      isGiftCategory,
      giftType,
      minOrderQty,
      metaTitle,
      metaDescription,
    } = req.body;

    const uploadedImage =
      (req as Request & { uploadedImage?: { url: string; publicId: string } }).uploadedImage;
    const uploadedHeroBanner =
      (req as Request & { uploadedHeroBanner?: { url: string; publicId: string } }).uploadedHeroBanner;

    const category = await Category.create({
      name,
      description,
      subcategories: parseSubcategories(subcategories),
      isActive: isActive === undefined ? true : String(isActive) === "true",
      isGiftCategory: String(isGiftCategory) === "true",
      giftType: giftType || undefined,
      minOrderQty: minOrderQty ? Number(minOrderQty) : 1,
      metaTitle: metaTitle?.trim(),
      metaDescription: metaDescription?.trim(),
      image: uploadedImage?.url,
      imagePublicId: uploadedImage?.publicId,
      heroBannerImage: uploadedHeroBanner?.url,
      heroBannerPublicId: uploadedHeroBanner?.publicId,
    });
    if (category.isActive !== false && category.slug) {
      notifyIndexNowStorefront(
        `/shop/collections/${encodeURIComponent(String(category.slug))}`,
      );
    }
    sendSuccess(res, { category }, "Category created", 201);
  },
);

// PATCH /api/admin/categories/:id — admin only
export const updateCategory = catchAsync(
  async (req: Request, res: Response, next: NextFunction) => {
    const update: Record<string, unknown> = { ...req.body };
    if (update.subcategories !== undefined) {
      update.subcategories = parseSubcategories(update.subcategories);
    }
    if (update.isActive !== undefined) {
      update.isActive = String(update.isActive) === "true";
    }
    if (update.isGiftCategory !== undefined) {
      update.isGiftCategory = String(update.isGiftCategory) === "true";
    }
    if (update.minOrderQty !== undefined) {
      const qty = Number(update.minOrderQty);
      update.minOrderQty = Number.isFinite(qty) && qty > 0 ? qty : 1;
    }
    if (update.giftType === "") {
      update.giftType = undefined;
    }
    
    // We need the existing category to check for old images
    const existingCategory = await Category.findById(req.params.id);
    if (!existingCategory) return next(new AppError("Category not found", 404));

    const publicIdsToDelete: string[] = [];

    const uploadedImage = (req as Request & { uploadedImage?: { url: string; publicId: string } }).uploadedImage;
    if (uploadedImage) {
      update.image = uploadedImage.url;
      update.imagePublicId = uploadedImage.publicId;
      if (existingCategory.imagePublicId) {
        publicIdsToDelete.push(existingCategory.imagePublicId);
      }
    }

    const uploadedHeroBanner = (req as Request & { uploadedHeroBanner?: { url: string; publicId: string } }).uploadedHeroBanner;
    if (uploadedHeroBanner) {
      update.heroBannerImage = uploadedHeroBanner.url;
      update.heroBannerPublicId = uploadedHeroBanner.publicId;
      if (existingCategory.heroBannerPublicId) {
        publicIdsToDelete.push(existingCategory.heroBannerPublicId);
      }
    }

    if (publicIdsToDelete.length > 0) {
      await enqueueImageDelete(publicIdsToDelete);
    }

    const category = await Category.findByIdAndUpdate(req.params.id, update, {
      new: true,
      runValidators: true,
    });

    if (!category) return next(new AppError("Category not found", 404));
    if (category.isActive !== false && category.slug) {
      notifyIndexNowStorefront(
        `/shop/collections/${encodeURIComponent(String(category.slug))}`,
      );
    }
    sendSuccess(res, { category }, "Category updated");
  },
);

// DELETE /api/admin/categories/:id — admin only
export const deleteCategory = catchAsync(
  async (req: Request, res: Response, next: NextFunction) => {
    const category = await Category.findById(req.params.id);
    if (!category) return next(new AppError("Category not found", 404));

    // Guard 1: legacy string-based product association
    const legacyCount = await Product.countDocuments({ category: category.name });
    // Guard 2: new FK-based product association (populated after migration)
    const fkCount = await Product.countDocuments({ categoryId: category._id });
    const productCount = Math.max(legacyCount, fkCount);

    if (productCount > 0) {
      return next(
        new AppError(
          `Cannot delete: ${productCount} product(s) use this category. Reassign them first.`,
          400,
        ),
      );
    }

    const publicIdsToDelete: string[] = [];
    if (category.imagePublicId) publicIdsToDelete.push(category.imagePublicId);
    if (category.heroBannerPublicId) publicIdsToDelete.push(category.heroBannerPublicId);
    if (publicIdsToDelete.length > 0) {
      await enqueueImageDelete(publicIdsToDelete);
    }

    await category.deleteOne();
    res.status(204).end();
  },
);

