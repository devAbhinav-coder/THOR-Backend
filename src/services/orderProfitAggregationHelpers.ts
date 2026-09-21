import type { PipelineStage } from "mongoose";
import { OFFLINE_MANUAL_VARIANT_SKU } from "../constants/offlineOrder";

export const OFFLINE_MANUAL_ITEM_SLUG = "offline-manual-item";

export type PaidOrderLineProfitOptions = {
  /** Exclude offline manual POS lines (merchandising / catalog analytics). */
  catalogOnly?: boolean;
};

function productLookupStages(): PipelineStage[] {
  return [
    {
      $lookup: {
        from: "products",
        localField: "items.product",
        foreignField: "_id",
        as: "productDoc",
      },
    },
    { $unwind: { path: "$productDoc", preserveNullAndEmptyArrays: true } },
  ];
}

/** Category bucket for charts: catalog category · subcategory, Premium prefix when applicable. */
function resolvedAnalyticsCategoryField() {
  return {
    resolvedAnalyticsCategory: {
      $let: {
        vars: {
          baseCat: { $ifNull: ["$productDoc.category", "Uncategorized"] },
          sub: {
            $trim: {
              input: { $ifNull: ["$productDoc.subcategory", ""] },
            },
          },
          isPrem: { $eq: [{ $ifNull: ["$productDoc.isPremium", false] }, true] },
        },
        in: {
          $cond: [
            "$$isPrem",
            {
              $cond: [
                { $gt: [{ $strLenCP: "$$sub" }, 0] },
                {
                  $concat: ["Premium / ", "$$baseCat", " / ", "$$sub"],
                },
                { $concat: ["Premium / ", "$$baseCat"] },
              ],
            },
            {
              $cond: [
                { $gt: [{ $strLenCP: "$$sub" }, 0] },
                { $concat: ["$$baseCat", " / ", "$$sub"] },
                "$$baseCat",
              ],
            },
          ],
        },
      },
    },
  };
}

/** Reporting fields appended after product lookup on unwound order lines. */
export function orderLineReportingFields() {
  return {
    $addFields: {
      resolvedLineCategory: {
        $cond: [
          {
            $and: [
              { $ne: [{ $ifNull: ["$items.lineCategory", ""] }, ""] },
            ],
          },
          "$items.lineCategory",
          { $ifNull: ["$productDoc.category", "Uncategorized"] },
        ],
      },
      ...resolvedAnalyticsCategoryField(),
      isManualOfflineLine: {
        $or: [
          { $eq: ["$items.slug", OFFLINE_MANUAL_ITEM_SLUG] },
          { $eq: ["$items.isOfflineManual", true] },
          { $eq: ["$items.variant.sku", OFFLINE_MANUAL_VARIANT_SKU] },
        ],
      },
    },
  };
}

export function orderLineProfitGroupKeyField() {
  return {
    $addFields: {
      profitGroupKey: {
        $cond: [
          "$isManualOfflineLine",
          {
            $concat: [
              "manual:",
              { $ifNull: ["$items.lineCategory", "$items.name"] },
            ],
          },
          { $toString: "$items.product" },
        ],
      },
    },
  };
}

/** Drop offline/manual POS lines after `$unwind: "$items"`. */
export function matchCatalogPaidOrderLine(): { $match: Record<string, unknown> } {
  return {
    $match: {
      $expr: {
        $and: [
          {
            $not: {
              $or: [
                { $eq: ["$items.isOfflineManual", true] },
                { $eq: ["$items.variant.sku", OFFLINE_MANUAL_VARIANT_SKU] },
                { $eq: ["$items.slug", OFFLINE_MANUAL_ITEM_SLUG] },
                {
                  $regexMatch: {
                    input: { $toLower: { $ifNull: ["$items.name", ""] } },
                    regex: "offline manual",
                  },
                },
              ],
            },
          },
          { $ne: [{ $ifNull: ["$items.product", null] }, null] },
        ],
      },
    },
  };
}

/** Top sellers by paid catalog lines (excludes offline manual mis-attributed to product ids). */
/** Paid catalog lines: match → unwind → drop manual offline → product lookup. */
export function catalogPaidOrderLineBaseStages(
  extraMatch: Record<string, unknown> = {},
): PipelineStage[] {
  return [
    { $match: { paymentStatus: "paid" as const, ...extraMatch } },
    { $unwind: "$items" },
    matchCatalogPaidOrderLine(),
    ...productLookupStages(),
    orderLineReportingFields(),
  ];
}

export function catalogPaidUnitsSoldStages(): PipelineStage[] {
  return [
    { $match: { paymentStatus: "paid" as const } },
    { $unwind: "$items" },
    matchCatalogPaidOrderLine(),
    { $group: { _id: null, units: { $sum: "$items.quantity" } } },
  ];
}

export function catalogRevenueByCategoryStages(limit = 10): PipelineStage[] {
  return [
    ...catalogPaidOrderLineBaseStages(),
    {
      $group: {
        _id: "$resolvedAnalyticsCategory",
        revenue: { $sum: { $multiply: ["$items.price", "$items.quantity"] } },
        units: { $sum: "$items.quantity" },
      },
    },
    { $match: { _id: { $nin: [null, ""] } } },
    { $sort: { revenue: -1 } },
    { $limit: limit },
  ];
}

export function catalogPaidTopProductsStages(limit = 5): PipelineStage[] {
  return [
    ...catalogPaidOrderLineBaseStages(),
    {
      $group: {
        _id: "$items.product",
        totalSold: { $sum: "$items.quantity" },
        revenue: { $sum: { $multiply: ["$items.price", "$items.quantity"] } },
        name: { $first: { $ifNull: ["$productDoc.name", "$items.name"] } },
        image: {
          $first: {
            $ifNull: [
              {
                $let: {
                  vars: {
                    hero: { $arrayElemAt: ["$productDoc.images", 0] },
                  },
                  in: "$$hero.url",
                },
              },
              "$items.image",
            ],
          },
        },
      },
    },
    { $sort: { totalSold: -1 } },
    { $limit: limit },
  ];
}

export function paidOrderLineProfitStages(
  extraMatch: Record<string, unknown> = {},
  options: PaidOrderLineProfitOptions = {},
) {
  const stages: PipelineStage[] = [
    { $match: { paymentStatus: "paid" as const, ...extraMatch } },
    { $unwind: "$items" },
  ];
  if (options.catalogOnly) {
    stages.push(matchCatalogPaidOrderLine());
  }
  stages.push(...productLookupStages(), orderLineReportingFields());
  return [
    ...stages,
    {
      $addFields: {
        matchedVariant: {
          $arrayElemAt: [
            {
              $filter: {
                input: { $ifNull: ["$productDoc.variants", []] },
                as: "v",
                cond: { $eq: ["$$v.sku", "$items.variant.sku"] },
              },
            },
            0,
          ],
        },
      },
    },
    {
      $addFields: {
        unitCost: {
          $ifNull: [
            "$items.costAtSale",
            { $ifNull: ["$matchedVariant.costPrice", 0] },
          ],
        },
        hasCostData: {
          $gt: [
            {
              $ifNull: [
                "$items.costAtSale",
                { $ifNull: ["$matchedVariant.costPrice", 0] },
              ],
            },
            0,
          ],
        },
        lineRevenue: { $multiply: ["$items.price", "$items.quantity"] },
      },
    },
    {
      $addFields: {
        lineCogs: { $multiply: ["$unitCost", "$items.quantity"] },
        lineProfit: {
          $subtract: [
            { $multiply: ["$items.price", "$items.quantity"] },
            { $multiply: ["$unitCost", "$items.quantity"] },
          ],
        },
      },
    },
    orderLineProfitGroupKeyField(),
  ] as PipelineStage[];
}
