import { categoryRepository } from "../../repositories/categoryRepository";
import Category from "../../models/Category";
import { buildCategoryProductCountMap } from "../categoryProductCountService";
import { cachedFetch } from "../cache/cachedFetch";

const CATEGORY_LIST_SOFT_TTL_SEC = 300;
const CATEGORY_LIST_HARD_TTL_SEC = 900;

function categoryListKey(filter: Record<string, unknown>): string {
  const active =
    filter.isActive === true ? "active"
    : filter.isActive === false ? "inactive"
    : "all";
  return `cache:categories:list:env:${active}`;
}

export async function getCachedCategoryList(
  filter: Record<string, unknown>,
): Promise<unknown[]> {
  return cachedFetch({
    key: categoryListKey(filter),
    softTtlSec: CATEGORY_LIST_SOFT_TTL_SEC,
    hardTtlSec: CATEGORY_LIST_HARD_TTL_SEC,
    fetchFresh: () => categoryRepository.list(filter),
  });
}

const CATEGORY_STATS_KEY = "cache:categories:stats:env";

export async function getCachedCategoryStats(): Promise<
  Array<Record<string, unknown>>
> {
  return cachedFetch({
    key: CATEGORY_STATS_KEY,
    softTtlSec: CATEGORY_LIST_SOFT_TTL_SEC,
    hardTtlSec: CATEGORY_LIST_HARD_TTL_SEC,
    fetchFresh: async () => {
      const categories = await Category.find({ isActive: true })
        .sort({ name: 1 })
        .lean();
      const countMap = await buildCategoryProductCountMap(categories);
      return categories.map((cat) => ({
        ...cat,
        productCount: countMap.get(String(cat._id)) || 0,
      }));
    },
  });
}

export function invalidateCategoryListCaches(): void {
  import("../cacheService").then(({ deleteCache, clearCachePattern }) => {
    void deleteCache(CATEGORY_STATS_KEY);
    void clearCachePattern("cache:categories:list:env:*");
  });
}
