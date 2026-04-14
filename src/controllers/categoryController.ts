import { Request, Response, NextFunction } from "express";
import Category from "../models/Category";
import Product from "../models/Product";
import catchAsync from "../utils/catchAsync";
import AppError from "../utils/AppError";
import { sendSuccess } from "../utils/response";
import { categoryRepository } from "../repositories/categoryRepository";

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
    // Aggregate product counts per category
    const productCounts = await Product.aggregate([
      { $match: { isActive: true } },
      { $group: { _id: "$category", count: { $sum: 1 } } },
    ]);

    const countMap = new Map<string, number>(
      productCounts.map((c) => [c._id as string, c.count as number]),
    );

    // Get all active categories and merge with counts
    const categories = await Category.find({ isActive: true })
      .sort({ name: 1 })
      .lean();

    const result = categories.map((cat) => ({
      ...cat,
      productCount: countMap.get(cat.name) || 0,
    }));

    sendSuccess(res, { categories: result });
  },
);

// GET /api/categories/:id — public
export const getCategory = catchAsync(
  async (req: Request, res: Response, next: NextFunction) => {
    const cat = await Category.findById(req.params.id);
    if (!cat) return next(new AppError("Category not found", 404));
    sendSuccess(res, { category: cat });
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
    } = req.body;

    const image =
      (req as Request & { uploadedImage?: string }).uploadedImage || undefined;

    const category = await Category.create({
      name,
      description,
      subcategories: parseSubcategories(subcategories),
      isActive: isActive === undefined ? true : String(isActive) === "true",
      isGiftCategory: String(isGiftCategory) === "true",
      giftType: giftType || undefined,
      minOrderQty: minOrderQty ? Number(minOrderQty) : 1,
      image,
    });
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
    if ((req as Request & { uploadedImage?: string }).uploadedImage) {
      update.image = (
        req as Request & { uploadedImage?: string }
      ).uploadedImage;
    }

    const category = await Category.findByIdAndUpdate(req.params.id, update, {
      new: true,
      runValidators: true,
    });

    if (!category) return next(new AppError("Category not found", 404));
    sendSuccess(res, { category }, "Category updated");
  },
);

// DELETE /api/admin/categories/:id — admin only
export const deleteCategory = catchAsync(
  async (req: Request, res: Response, next: NextFunction) => {
    const category = await Category.findById(req.params.id);
    if (!category) return next(new AppError("Category not found", 404));

    // Check if products exist under this category
    const productCount = await Product.countDocuments({
      category: category.name,
    });
    if (productCount > 0) {
      return next(
        new AppError(
          `Cannot delete: ${productCount} product(s) use this category. Reassign them first.`,
          400,
        ),
      );
    }

    await category.deleteOne();
    res.status(204).end();
  },
);
