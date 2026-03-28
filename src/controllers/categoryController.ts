import { Request, Response, NextFunction } from 'express';
import Category from '../models/Category';
import Product from '../models/Product';
import catchAsync from '../utils/catchAsync';
import AppError from '../utils/AppError';

// GET /api/categories — public
export const getAllCategories = catchAsync(async (req: Request, res: Response) => {
  const filter: any = {};
  if (req.query.active !== 'false') filter.isActive = true;

  const categories = await Category.find(filter).sort({ name: 1 });
  res.status(200).json({ status: 'success', results: categories.length, data: { categories } });
});

// GET /api/categories/stats — public — returns categories with real product counts
export const getCategoryStats = catchAsync(async (_req: Request, res: Response) => {
  // Aggregate product counts per category
  const productCounts = await Product.aggregate([
    { $match: { isActive: true } },
    { $group: { _id: '$category', count: { $sum: 1 } } },
  ]);

  const countMap = new Map<string, number>(
    productCounts.map((c) => [c._id as string, c.count as number])
  );

  // Get all active categories and merge with counts
  const categories = await Category.find({ isActive: true }).sort({ name: 1 }).lean();

  const result = categories.map((cat) => ({
    ...cat,
    productCount: countMap.get(cat.name) || 0,
  }));

  res.status(200).json({ status: 'success', results: result.length, data: { categories: result } });
});

// GET /api/categories/:id — public
export const getCategory = catchAsync(async (req: Request, res: Response, next: NextFunction) => {
  const cat = await Category.findById(req.params.id);
  if (!cat) return next(new AppError('Category not found', 404));
  res.status(200).json({ status: 'success', data: { category: cat } });
});

function parseSubcategories(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.map(String).filter(Boolean);
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed.map(String).filter(Boolean);
    } catch {
      // comma-separated fallback
      return raw.split(',').map((s) => s.trim()).filter(Boolean);
    }
  }
  return [];
}

// POST /api/admin/categories — admin only
export const createCategory = catchAsync(async (req: Request, res: Response) => {
  const { name, description, subcategories, isActive } = req.body;

  const image = (req as any).uploadedImage || undefined;

  const category = await Category.create({
    name,
    description,
    subcategories: parseSubcategories(subcategories),
    isActive,
    image,
  });
  res.status(201).json({ status: 'success', data: { category } });
});

// PATCH /api/admin/categories/:id — admin only
export const updateCategory = catchAsync(async (req: Request, res: Response, next: NextFunction) => {
  const update: any = { ...req.body };
  if (update.subcategories !== undefined) {
    update.subcategories = parseSubcategories(update.subcategories);
  }
  if ((req as any).uploadedImage) update.image = (req as any).uploadedImage;

  const category = await Category.findByIdAndUpdate(req.params.id, update, {
    new: true,
    runValidators: true,
  });

  if (!category) return next(new AppError('Category not found', 404));
  res.status(200).json({ status: 'success', data: { category } });
});

// DELETE /api/admin/categories/:id — admin only
export const deleteCategory = catchAsync(async (req: Request, res: Response, next: NextFunction) => {
  const category = await Category.findById(req.params.id);
  if (!category) return next(new AppError('Category not found', 404));

  // Check if products exist under this category
  const productCount = await Product.countDocuments({ category: category.name });
  if (productCount > 0) {
    return next(
      new AppError(
        `Cannot delete: ${productCount} product(s) use this category. Reassign them first.`,
        400
      )
    );
  }

  await category.deleteOne();
  res.status(204).json({ status: 'success', data: null });
});
