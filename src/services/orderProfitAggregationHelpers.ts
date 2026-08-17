import { OFFLINE_MANUAL_VARIANT_SKU } from "../constants/offlineOrder";

export const OFFLINE_MANUAL_ITEM_SLUG = "offline-manual-item";

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

export function paidOrderLineProfitStages(extraMatch: Record<string, unknown> = {}) {
  return [
    { $match: { paymentStatus: "paid" as const, ...extraMatch } },
    { $unwind: "$items" },
    {
      $lookup: {
        from: "products",
        localField: "items.product",
        foreignField: "_id",
        as: "productDoc",
      },
    },
    { $unwind: { path: "$productDoc", preserveNullAndEmptyArrays: true } },
    orderLineReportingFields(),
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
  ];
}
