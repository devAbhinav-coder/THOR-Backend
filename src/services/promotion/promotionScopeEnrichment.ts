import Category from '../../models/Category';
import SubCategory from '../../models/SubCategory';
import { COUPON_QUERY_MAX_MS } from '../coupon/couponBusinessRules';
import type { PromotionLike } from './promotionBusinessRules';

/** Resolve category/subcategory IDs to display names for scope matching on PDP. */
export async function enrichPromotionsScopeNames(
  promotions: PromotionLike[],
): Promise<PromotionLike[]> {
  const categoryIds = new Set<string>();
  const subcategoryIds = new Set<string>();

  for (const promotion of promotions) {
    const scope = promotion.scopeType || 'all';
    if (
      scope === 'categories' &&
      !(promotion.applicableCategories?.length ?? 0) &&
      promotion.categoryIds?.length
    ) {
      for (const id of promotion.categoryIds) categoryIds.add(String(id));
    }
    if (
      scope === 'subcategories' &&
      !(promotion.applicableSubcategoryNames?.length ?? 0) &&
      promotion.subcategoryIds?.length
    ) {
      for (const id of promotion.subcategoryIds) subcategoryIds.add(String(id));
    }
  }

  if (!categoryIds.size && !subcategoryIds.size) return promotions;

  const [categories, subcategories] = await Promise.all([
    categoryIds.size ?
      Category.find({ _id: { $in: [...categoryIds] } })
        .select('name')
        .maxTimeMS(COUPON_QUERY_MAX_MS)
        .lean<{ _id: unknown; name: string }[]>()
    : Promise.resolve([]),
    subcategoryIds.size ?
      SubCategory.find({ _id: { $in: [...subcategoryIds] } })
        .select('name')
        .maxTimeMS(COUPON_QUERY_MAX_MS)
        .lean<{ _id: unknown; name: string }[]>()
    : Promise.resolve([]),
  ]);

  const categoryNameById = new Map(
    categories.map((c) => [String(c._id), c.name] as const),
  );
  const subcategoryNameById = new Map(
    subcategories.map((s) => [String(s._id), s.name] as const),
  );

  return promotions.map((promotion) => {
    const scope = promotion.scopeType || 'all';
    let next = promotion;

    if (
      scope === 'categories' &&
      !(promotion.applicableCategories?.length ?? 0) &&
      promotion.categoryIds?.length
    ) {
      next = {
        ...next,
        applicableCategories: promotion.categoryIds
          .map((id) => categoryNameById.get(String(id)))
          .filter((name): name is string => Boolean(name?.trim())),
      };
    }

    if (
      scope === 'subcategories' &&
      !(promotion.applicableSubcategoryNames?.length ?? 0) &&
      promotion.subcategoryIds?.length
    ) {
      next = {
        ...next,
        applicableSubcategoryNames: promotion.subcategoryIds
          .map((id) => subcategoryNameById.get(String(id)))
          .filter((name): name is string => Boolean(name?.trim())),
      };
    }

    return next;
  });
}
