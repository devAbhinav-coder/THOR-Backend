import { Request, Response } from 'express';
import catchAsync from '../types/utils/catchAsync';
import Category from '../models/Category';
import SubCategory from '../models/SubCategory';
import AppError from '../types/utils/AppError';
import { sendSuccess, sendPaginated } from '../types/utils/response';
import { parseProductListQuery, mapSortToAdvanced } from '../services/productQueryParser';
import { advancedSearchService } from '../services/advancedSearchService';
import { reconcileProductJson } from '../types/utils/productStock';
import { getFilterOptionsForCategory } from '../services/productFilterService'; // We will create/update this

function leanProduct(p: Record<string, unknown>) {
  return reconcileProductJson(p as Parameters<typeof reconcileProductJson>[0]);
}

// ─── Collections (Category Level) ────────────────────────────────────────────

export const getCollectionDetails = catchAsync(async (req: Request, res: Response) => {
  const { catSlug } = req.params;
  
  const category = await Category.findOne({ slug: catSlug, isActive: true }).lean();
  if (!category) {
    throw new AppError('Collection not found', 404);
  }

  const subcategories = await SubCategory.find({ 
    categoryId: category._id, 
    isActive: true 
  }).sort({ sortOrder: 1, name: 1 }).lean();

  return sendSuccess(res, {
    category,
    subcategories,
  });
});

export const getCollectionProducts = catchAsync(async (req: Request, res: Response) => {
  const { catSlug } = req.params;
  
  const category = await Category.findOne({ slug: catSlug, isActive: true }).lean();
  if (!category) {
    throw new AppError('Collection not found', 404);
  }

  const parsedSearch = parseProductListQuery(req);
  // Force filter by this category
  parsedSearch.categories = [category._id.toString()];

  const { sortBy, sortOrder } = mapSortToAdvanced(
    typeof req.query.sortBy === 'string' ? req.query.sortBy
    : typeof req.query.sort === 'string' ? req.query.sort
    : 'newest'
  );

  const searchResult = await advancedSearchService.searchProducts({
    query: '',
    sortBy,
    sortOrder,
    page: parsedSearch.page,
    limit: parsedSearch.limit,
    categories: parsedSearch.categories,
    fabrics: parsedSearch.fabrics,
    minPrice: parsedSearch.minPrice,
    maxPrice: parsedSearch.maxPrice,
    minRating: parsedSearch.minRating,
    isFeatured: parsedSearch.isFeatured,
    onSale: parsedSearch.onSale,
    adminScope: false,
    useCache: true,
  });

  sendPaginated(
    res,
    {
      products: searchResult.products.map(leanProduct),
    },
    {
      page: searchResult.page,
      limit: searchResult.limit,
      total: searchResult.total,
      hasNextPage: searchResult.page < searchResult.totalPages,
    }
  );
});

export const getCollectionFilters = catchAsync(async (req: Request, res: Response) => {
  const { catSlug } = req.params;
  
  const category = await Category.findOne({ slug: catSlug, isActive: true }).lean();
  if (!category) {
    throw new AppError('Collection not found', 404);
  }

  // We will pass category._id to getFilterOptionsForCategory
  const filters = await getFilterOptionsForCategory(category._id.toString());
  return sendSuccess(res, filters);
});

// ─── Subcollections (SubCategory Level) ──────────────────────────────────────

export const getSubcollectionDetails = catchAsync(async (req: Request, res: Response) => {
  const { catSlug, subSlug } = req.params;
  
  const subcategory = await SubCategory.findOne({ 
    categorySlug: catSlug, 
    slug: subSlug, 
    isActive: true 
  }).populate('categoryId').lean();

  if (!subcategory) {
    throw new AppError('Subcollection not found', 404);
  }

  // Find siblings
  const siblings = await SubCategory.find({
    categoryId: subcategory.categoryId,
    _id: { $ne: subcategory._id },
    isActive: true
  }).sort({ sortOrder: 1, name: 1 }).limit(10).lean();

  return sendSuccess(res, {
    subcategory,
    category: subcategory.categoryId, // populated
    relatedCollections: siblings
  });
});

export const getSubcollectionProducts = catchAsync(async (req: Request, res: Response) => {
  const { catSlug, subSlug } = req.params;
  
  const subcategory = await SubCategory.findOne({ 
    categorySlug: catSlug, 
    slug: subSlug, 
    isActive: true 
  }).lean();

  if (!subcategory) {
    throw new AppError('Subcollection not found', 404);
  }

  const parsedSearch = parseProductListQuery(req);
  
  // Custom: searchProducts takes subcategories too now. We will need to update advancedSearchService.
  // For now, let's pass it as a special field or update parseProductListQuery.
  
  const { sortBy, sortOrder } = mapSortToAdvanced(
    typeof req.query.sortBy === 'string' ? req.query.sortBy
    : typeof req.query.sort === 'string' ? req.query.sort
    : 'newest'
  );

  const searchResult = await advancedSearchService.searchProducts({
    query: '',
    sortBy,
    sortOrder,
    page: parsedSearch.page,
    limit: parsedSearch.limit,
    categories: [subcategory.categoryId.toString()],
    subcategories: [subcategory._id.toString()], // We need to add this
    fabrics: parsedSearch.fabrics,
    minPrice: parsedSearch.minPrice,
    maxPrice: parsedSearch.maxPrice,
    minRating: parsedSearch.minRating,
    isFeatured: parsedSearch.isFeatured,
    onSale: parsedSearch.onSale,
    adminScope: false,
    useCache: true,
  });

  sendPaginated(
    res,
    {
      products: searchResult.products.map(leanProduct),
    },
    {
      page: searchResult.page,
      limit: searchResult.limit,
      total: searchResult.total,
      hasNextPage: searchResult.page < searchResult.totalPages,
    }
  );
});

export const getSubcollectionFilters = catchAsync(async (req: Request, res: Response) => {
  const { catSlug, subSlug } = req.params;
  
  const subcategory = await SubCategory.findOne({ 
    categorySlug: catSlug, 
    slug: subSlug, 
    isActive: true 
  }).lean();

  if (!subcategory) {
    throw new AppError('Subcollection not found', 404);
  }

  const filters = await getFilterOptionsForCategory(subcategory.categoryId.toString(), subcategory._id.toString());
  return sendSuccess(res, filters);
});
