import Category from '../../models/Category';
import SubCategory from '../../models/SubCategory';
import { COUPON_QUERY_MAX_MS } from '../coupon/couponBusinessRules';

/** Persist category/subcategory display names alongside IDs for PDP scope matching. */
export async function resolvePromotionScopeNames(
  data: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const scope = (data.scopeType as string) || 'all';
  const next = { ...data };

  if (scope === 'categories') {
    const categoryIds = (data.categoryIds as string[] | undefined) || [];
    if (categoryIds.length) {
      const cats = await Category.find({ _id: { $in: categoryIds } })
        .select('name')
        .maxTimeMS(COUPON_QUERY_MAX_MS)
        .lean<{ name: string }[]>();
      next.applicableCategories = cats.map((c) => c.name).filter(Boolean);
    } else {
      next.applicableCategories = [];
    }
  } else {
    next.applicableCategories = [];
  }

  if (scope === 'subcategories') {
    const subcategoryIds = (data.subcategoryIds as string[] | undefined) || [];
    if (subcategoryIds.length) {
      const subs = await SubCategory.find({ _id: { $in: subcategoryIds } })
        .select('name')
        .maxTimeMS(COUPON_QUERY_MAX_MS)
        .lean<{ name: string }[]>();
      next.applicableSubcategoryNames = subs.map((s) => s.name).filter(Boolean);
    } else {
      next.applicableSubcategoryNames = [];
    }
  } else {
    next.applicableSubcategoryNames = [];
  }

  return next;
}
