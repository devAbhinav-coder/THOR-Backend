import type { Types } from "mongoose";
import Product from "../models/Product";

export interface CategoryProductCountSource {
  _id: Types.ObjectId | string;
  name: string;
}

/**
 * Accurate per-category product counts for storefront cards.
 * Products may use `categoryId` (FK) and/or legacy string `category` (name).
 */
export async function buildCategoryProductCountMap(
  categories: CategoryProductCountSource[],
): Promise<Map<string, number>> {
  const [byCategoryId, byLegacyName] = await Promise.all([
    Product.aggregate<{ _id: Types.ObjectId; count: number }>([
      { $match: { isActive: true, categoryId: { $exists: true, $ne: null } } },
      { $group: { _id: "$categoryId", count: { $sum: 1 } } },
    ]),
    Product.aggregate<{ _id: string; count: number }>([
      {
        $match: {
          isActive: true,
          category: { $exists: true, $type: "string", $nin: ["", "Gifting"] },
          $or: [{ categoryId: { $exists: false } }, { categoryId: null }],
        },
      },
      {
        $group: {
          _id: { $toLower: { $trim: { input: "$category" } } },
          count: { $sum: 1 },
        },
      },
    ]),
  ]);

  const idMap = new Map(
    byCategoryId.map((row) => [String(row._id), row.count as number]),
  );
  const nameMap = new Map(
    byLegacyName.map((row) => [row._id, row.count as number]),
  );

  const result = new Map<string, number>();
  for (const cat of categories) {
    const id = String(cat._id);
    const fromId = idMap.get(id) ?? 0;
    const fromName = nameMap.get(String(cat.name || "").trim().toLowerCase()) ?? 0;
    result.set(id, fromId + fromName);
  }

  return result;
}
