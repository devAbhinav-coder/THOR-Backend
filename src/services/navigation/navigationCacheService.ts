import { categoryRepository } from "../../repositories/categoryRepository";
import { subcategoryRepository } from "../../repositories/subcategoryRepository";
import { cachedFetch } from "../cache/cachedFetch";
import { deleteCache } from "../cacheService";

export const MEGA_MENU_CACHE_KEY = "cache:navigation:mega-menu:env";
const MEGA_MENU_SOFT_TTL_SEC = 300;
const MEGA_MENU_HARD_TTL_SEC = 900;

export async function fetchMegaMenuPayload(): Promise<Record<string, unknown>> {
  const categories = await categoryRepository.list({
    isActive: true,
    isGiftCategory: { $ne: true },
  });

  const allSubcategories = await subcategoryRepository.listAll({
    isActive: true,
  });

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
    subcategories: (
      subcatMap.get(String(cat._id)) || []
    ).map((s) => ({
      _id: s._id,
      name: s.name,
      slug: s.slug,
      categorySlug: s.categorySlug,
      image: s.image,
      productCount: s.productCount,
    })),
  }));

  return { categories: result };
}

export async function getMegaMenuCached(): Promise<Record<string, unknown>> {
  return cachedFetch({
    key: MEGA_MENU_CACHE_KEY,
    softTtlSec: MEGA_MENU_SOFT_TTL_SEC,
    hardTtlSec: MEGA_MENU_HARD_TTL_SEC,
    fetchFresh: fetchMegaMenuPayload,
  });
}

export function invalidateMegaMenuCache(): void {
  void deleteCache(MEGA_MENU_CACHE_KEY);
}
