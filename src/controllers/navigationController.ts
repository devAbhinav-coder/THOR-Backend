/**
 * Navigation controller — powers the mega-menu and top-level navigation data.
 *
 * GET /api/navigation/mega-menu
 * Returns all active, non-gift categories with their nested active subcategories.
 * Cached in-process for 300s (falls back gracefully if Redis is unavailable).
 */

import { Request, Response } from 'express';
import catchAsync from '../types/utils/catchAsync';
import { sendSuccess } from '../types/utils/response';
import { categoryRepository } from '../repositories/categoryRepository';
import { subcategoryRepository } from '../repositories/subcategoryRepository';

// ─── In-process cache (300s TTL) ─────────────────────────────────────────────

let _megaMenuCache: Record<string, unknown> | null = null;

let _megaMenuCachedAt = 0;
const MEGA_MENU_TTL_MS = 300_000; // 5 minutes

function getMegaMenuFromCache() {
  if (_megaMenuCache && Date.now() - _megaMenuCachedAt < MEGA_MENU_TTL_MS) {
    return _megaMenuCache;
  }
  return null;
}

function setMegaMenuCache(data: Record<string, unknown>) {

  _megaMenuCache = data;
  _megaMenuCachedAt = Date.now();
}

/** Call this when a category or subcategory is created/updated/deleted. */
export function invalidateMegaMenuCache() {
  _megaMenuCache = null;
  _megaMenuCachedAt = 0;
}

// ─── Handler ─────────────────────────────────────────────────────────────────

/**
 * GET /api/navigation/mega-menu
 *
 * Response shape:
 * {
 *   categories: [
 *     { _id, name, slug, image, subcategories: [{ _id, name, slug, categorySlug, image, productCount }] }
 *   ]
 * }
 */
export const getMegaMenu = catchAsync(async (_req: Request, res: Response) => {
  const cached = getMegaMenuFromCache();
  if (cached) {
    return sendSuccess(res, cached);
  }

  // Only non-gift, active categories
  const categories = await categoryRepository.list({ isActive: true, isGiftCategory: { $ne: true } });

  // Fetch all active subcategories in one query, then group in memory
  const allSubcategories = await subcategoryRepository.listAll({ isActive: true });

  // Group subcategories by categoryId
  const subcatMap = new Map<string, typeof allSubcategories>();
  for (const subcat of allSubcategories) {
    const key = subcat.categoryId.toString();
    if (!subcatMap.has(key)) subcatMap.set(key, []);
    subcatMap.get(key)!.push(subcat);
  }

  const result = categories.map((cat) => ({
    _id: cat._id,
    name: cat.name,
    slug: cat.slug,
    image: cat.image,
    heroBannerImage: cat.heroBannerImage,
    metaTitle: cat.metaTitle,
    subcategories: (subcatMap.get((cat._id as import('mongoose').Types.ObjectId).toString()) || []).map((s) => ({
      _id: s._id,
      name: s.name,
      slug: s.slug,
      categorySlug: s.categorySlug,
      image: s.image,
      productCount: s.productCount,
    })),
  }));

  const payload: Record<string, unknown> = { categories: result };

  setMegaMenuCache(payload);

  return sendSuccess(res, payload);
});
