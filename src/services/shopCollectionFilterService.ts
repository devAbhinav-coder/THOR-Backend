import Category from '../models/Category';
import SubCategory from '../models/SubCategory';

function sameName(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/**
 * Builds a Mongo filter for shop category + subcategory selections.
 *
 * When both are present, uses OR logic per category:
 * - Category with selected subs → match that category AND those subs only
 * - Category without selected subs → match the whole category
 *
 * Example: Sarees + Banarasi sub + Salwar Suits →
 *   (Sarees ∧ Banarasi) ∨ (Salwar Suits)
 */
export async function buildShopCollectionFilter(
  categories: string[],
  subcategories: string[],
): Promise<Record<string, unknown> | null> {
  if (categories.length === 0 && subcategories.length === 0) return null;

  if (categories.length > 0 && subcategories.length === 0) {
    return { category: { $in: categories } };
  }

  if (categories.length === 0 && subcategories.length > 0) {
    return { subcategory: { $in: subcategories } };
  }

  const subsInDb = await SubCategory.find({
    isActive: true,
    name: { $in: subcategories },
  })
    .select('name categorySlug categoryId')
    .lean();

  const categoryIds = [
    ...new Set(subsInDb.map((s) => String(s.categoryId)).filter(Boolean)),
  ];

  const categoryDocs = await Category.find({
    $or: [
      { name: { $in: categories } },
      ...(categoryIds.length ? [{ _id: { $in: categoryIds } }] : []),
    ],
    isActive: true,
  })
    .select('name slug _id')
    .lean();

  const slugToName = new Map(
    categoryDocs.map((c) => [String(c.slug).toLowerCase(), c.name]),
  );
  const idToName = new Map(
    categoryDocs.map((c) => [String(c._id), c.name]),
  );

  const subsByCategoryName = new Map<string, string[]>();
  for (const sub of subsInDb) {
    const catName =
      idToName.get(String(sub.categoryId)) ||
      slugToName.get(String(sub.categorySlug).toLowerCase());
    if (!catName) continue;
    const list = subsByCategoryName.get(catName) ?? [];
    list.push(sub.name);
    subsByCategoryName.set(catName, list);
  }

  const matchedSubNames = new Set(subsInDb.map((s) => s.name));
  const orphanSubs = subcategories.filter((s) => !matchedSubNames.has(s));

  const orClauses: Record<string, unknown>[] = [];

  for (const cat of categories) {
    const subsForCat =
      [...subsByCategoryName.entries()]
        .find(([name]) => sameName(name, cat))?.[1] ?? [];

    if (subsForCat.length > 0) {
      orClauses.push({ category: cat, subcategory: { $in: subsForCat } });
    } else {
      orClauses.push({ category: cat });
    }
  }

  for (const [catName, subs] of subsByCategoryName) {
    const parentSelected = categories.some((c) => sameName(c, catName));
    if (!parentSelected) {
      orClauses.push({ category: catName, subcategory: { $in: subs } });
    }
  }

  if (orphanSubs.length > 0) {
    orClauses.push({ subcategory: { $in: orphanSubs } });
  }

  if (orClauses.length === 0) {
    return { category: { $in: categories }, subcategory: { $in: subcategories } };
  }
  if (orClauses.length === 1) return orClauses[0];
  return { $or: orClauses };
}
