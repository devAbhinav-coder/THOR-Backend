import mongoose from "mongoose";
import Wishlist from "../../models/Wishlist";
import Product from "../../models/Product";
import AppError from "../../types/utils/AppError";
import logger from "../../types/utils/logger";
import { getRequestContext } from "../../types/utils/requestContext";
import { WISHLIST_MAX_ITEMS, WISHLIST_QUERY_MAX_MS } from "./wishlistConstants";
import { wishlistCacheService } from "./wishlistCacheService";
import {
  serializeWishlistProduct,
  serializeWishlistProducts,
  WishlistProductDto,
} from "./wishlistDto";
import {
  recordWishlistMetric,
  recordProductWishlisted,
} from "./wishlistMetricsService";
import { emitWishlistEvent } from "./wishlistEventService";
import WishlistPriceAlert from "../../models/WishlistPriceAlert";
import { getActiveSaleCampaigns } from "../sale/saleCacheService";
import { resolveEffectivePrice } from "../sale/salePriceService";

export type WishlistListOptions = {
  paginated: boolean;
  page: number;
  limit: number;
};

export type WishlistListResult = {
  products: WishlistProductDto[];
  paginated: boolean;
  pagination?: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
    hasNextPage: boolean;
    hasPrevPage: boolean;
  };
};

type RawWishlistProduct = Parameters<typeof serializeWishlistProduct>[0];

async function assertProductExists(productId: string): Promise<void> {
  const exists = await Product.exists({ _id: productId }).maxTimeMS(
    WISHLIST_QUERY_MAX_MS,
  );
  if (!exists) {
    throw new AppError("Product not found.", 404);
  }
}

function isDuplicateKeyError(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: number }).code === 11000
  );
}

/** Add product — $expr cap check cannot be combined with upsert in MongoDB. */
async function addProductToWishlist(
  userObjectId: mongoose.Types.ObjectId,
  productObjectId: mongoose.Types.ObjectId,
): Promise<{ products: mongoose.Types.ObjectId[] }> {
  const added = await Wishlist.findOneAndUpdate(
    {
      user: userObjectId,
      $expr: {
        $lt: [{ $size: { $ifNull: ["$products", []] } }, WISHLIST_MAX_ITEMS],
      },
    },
    { $addToSet: { products: productObjectId } },
    {
      new: true,
      projection: { products: 1 },
      maxTimeMS: WISHLIST_QUERY_MAX_MS,
    },
  ).lean();

  if (added) {
    return { products: added.products ?? [] };
  }

  const existing = await Wishlist.findOne({ user: userObjectId })
    .select("products")
    .lean()
    .maxTimeMS(WISHLIST_QUERY_MAX_MS);

  if (existing) {
    const count = existing.products?.length ?? 0;
    if (count >= WISHLIST_MAX_ITEMS) {
      throw new AppError(
        `Wishlist cannot exceed ${WISHLIST_MAX_ITEMS} items.`,
        400,
      );
    }

    const retry = await Wishlist.findOneAndUpdate(
      { user: userObjectId },
      { $addToSet: { products: productObjectId } },
      {
        new: true,
        projection: { products: 1 },
        maxTimeMS: WISHLIST_QUERY_MAX_MS,
      },
    ).lean();

    if (!retry) {
      throw new AppError("Unable to update wishlist.", 500);
    }
    return { products: retry.products ?? [] };
  }

  try {
    const created = await Wishlist.findOneAndUpdate(
      { user: userObjectId },
      {
        $setOnInsert: {
          user: userObjectId,
          products: [productObjectId],
        },
      },
      {
        upsert: true,
        new: true,
        projection: { products: 1 },
        maxTimeMS: WISHLIST_QUERY_MAX_MS,
      },
    ).lean();

    if (!created) {
      throw new AppError("Unable to update wishlist.", 500);
    }

    const hasProduct = (created.products ?? []).some((id) =>
      id.equals(productObjectId),
    );
    if (hasProduct) {
      return { products: created.products ?? [] };
    }

    const retry = await Wishlist.findOneAndUpdate(
      { user: userObjectId },
      { $addToSet: { products: productObjectId } },
      {
        new: true,
        projection: { products: 1 },
        maxTimeMS: WISHLIST_QUERY_MAX_MS,
      },
    ).lean();

    if (!retry) {
      throw new AppError("Unable to update wishlist.", 500);
    }
    return { products: retry.products ?? [] };
  } catch (err) {
    if (isDuplicateKeyError(err)) {
      return addProductToWishlist(userObjectId, productObjectId);
    }
    throw err;
  }
}

async function recordWishlistPriceBaseline(
  userId: string,
  productId: string,
): Promise<void> {
  const product = await Product.findById(productId).select("price").lean();
  if (!product) return;
  const campaigns = await getActiveSaleCampaigns();
  const baselinePrice = resolveEffectivePrice(
    { price: product.price, _id: productId },
    campaigns,
  ).effectivePrice;
  await WishlistPriceAlert.findOneAndUpdate(
    { user: userId, product: productId },
    { $setOnInsert: { baselinePrice } },
    { upsert: true },
  );
}

async function fetchWishlistProductsOrdered(
  userId: string,
  options: WishlistListOptions,
): Promise<{ products: RawWishlistProduct[]; total: number }> {
  const userObjectId = new mongoose.Types.ObjectId(userId);
  const skip = (options.page - 1) * options.limit;

  const pipeline: mongoose.PipelineStage[] = [
    { $match: { user: userObjectId } },
    {
      $project: {
        products: 1,
        totalProducts: { $size: { $ifNull: ["$products", []] } },
      },
    },
  ];

  if (options.paginated) {
    pipeline.push({
      $project: {
        totalProducts: 1,
        products: { $slice: ["$products", skip, options.limit] },
      },
    });
  }

  pipeline.push(
    {
      $lookup: {
        from: "products",
        let: { productIds: "$products" },
        pipeline: [
          {
            $match: {
              $expr: { $in: ["$_id", "$$productIds"] },
              isActive: true,
            },
          },
          {
            $project: {
              name: 1,
              slug: 1,
              images: 1,
              price: 1,
              comparePrice: 1,
              ratings: 1,
              category: 1,
              fabric: 1,
              shortDescription: 1,
              description: 1,
              isFeatured: 1,
              isCustomizable: 1,
              customFields: 1,
              isActive: 1,
              totalStock: 1,
              variants: {
                sku: 1,
                size: 1,
                color: 1,
                colorCode: 1,
                stock: 1,
                price: 1,
              },
            },
          },
        ],
        as: "productDocs",
      },
    },
    {
      $addFields: {
        products: {
          $filter: {
            input: {
              $map: {
                input: "$products",
                as: "pid",
                in: {
                  $first: {
                    $filter: {
                      input: "$productDocs",
                      as: "doc",
                      cond: { $eq: ["$$doc._id", "$$pid"] },
                    },
                  },
                },
              },
            },
            as: "item",
            cond: { $ne: ["$$item", null] },
          },
        },
      },
    },
    { $project: { products: 1, totalProducts: 1 } },
  );

  const rows = await Wishlist.aggregate(pipeline).option({
    maxTimeMS: WISHLIST_QUERY_MAX_MS,
  });
  const row = rows[0] as
    | { products?: RawWishlistProduct[]; totalProducts?: number }
    | undefined;

  return {
    products: row?.products ?? [],
    total: row?.totalProducts ?? 0,
  };
}

export const wishlistService = {
  async getWishlist(
    userId: string,
    options: WishlistListOptions,
  ): Promise<WishlistListResult> {
    const page = options.paginated ? options.page : undefined;
    const limit = options.paginated ? options.limit : undefined;

    const cached = await wishlistCacheService.getList(userId, page, limit);
    if (cached) {
      recordWishlistMetric("wishlist.fetch.cache_hit", { userId });
      const total = cached.total ?? cached.products.length;
      return buildListResult(cached.products, options, total);
    }

    recordWishlistMetric("wishlist.fetch.cache_miss", { userId });

    const { products: rawProducts, total } = await fetchWishlistProductsOrdered(
      userId,
      options,
    );
    const products = serializeWishlistProducts(rawProducts);

    await wishlistCacheService.setList(
      userId,
      { products, total },
      page,
      limit,
    );
    await wishlistCacheService.setCount(userId, total);

    recordWishlistMetric("wishlist.fetch", { userId, count: products.length });

    return buildListResult(products, options, total);
  },

  async toggleProduct(
    userId: string,
    productId: string,
  ): Promise<{ wishlistCount: number; action: "added" | "removed" }> {
    const normalizedId = productId.trim();
    await assertProductExists(normalizedId);

    const productObjectId = new mongoose.Types.ObjectId(normalizedId);
    const userObjectId = new mongoose.Types.ObjectId(userId);
    const ctx = getRequestContext();

    const removed = await Wishlist.findOneAndUpdate(
      { user: userObjectId, products: productObjectId },
      { $pull: { products: productObjectId } },
      {
        new: true,
        projection: { products: 1 },
        maxTimeMS: WISHLIST_QUERY_MAX_MS,
      },
    ).lean();

    if (removed) {
      const wishlistCount = removed.products?.length ?? 0;
      wishlistCacheService.scheduleInvalidate(userId);
      recordWishlistMetric("wishlist.toggle.removed", {
        userId,
        productId: normalizedId,
      });
      emitWishlistEvent({
        userId,
        productId: normalizedId,
        action: "removed",
        wishlistCount,
      });
      logger.info({
        msg: "wishlist_toggle",
        wishlistAction: "removed",
        userId,
        productId: normalizedId,
        wishlistCount,
        requestId: ctx?.requestId,
        traceId: ctx?.traceId,
      });
      return { wishlistCount, action: "removed" };
    }

    let addedProducts: mongoose.Types.ObjectId[];
    try {
      const result = await addProductToWishlist(userObjectId, productObjectId);
      addedProducts = result.products;
    } catch (err) {
      if (
        err instanceof AppError &&
        err.statusCode === 400 &&
        err.message.includes(String(WISHLIST_MAX_ITEMS))
      ) {
        recordWishlistMetric("wishlist.toggle.cap_reached", {
          userId,
          productId: normalizedId,
        });
      }
      throw err;
    }

    const wishlistCount = addedProducts.length;
    wishlistCacheService.scheduleInvalidate(userId);
    recordWishlistMetric("wishlist.toggle.added", {
      userId,
      productId: normalizedId,
    });
    recordProductWishlisted(normalizedId);
    emitWishlistEvent({
      userId,
      productId: normalizedId,
      action: "added",
      wishlistCount,
    });
    logger.info({
      msg: "wishlist_toggle",
      wishlistAction: "added",
      userId,
      productId: normalizedId,
      wishlistCount,
      requestId: ctx?.requestId,
      traceId: ctx?.traceId,
    });

    void recordWishlistPriceBaseline(userId, normalizedId).catch(() => {});

    return { wishlistCount, action: "added" };
  },
};

function buildListResult(
  products: WishlistProductDto[],
  options: WishlistListOptions,
  total: number,
): WishlistListResult {
  if (!options.paginated) {
    return { products, paginated: false };
  }

  const totalPages = Math.max(1, Math.ceil(total / options.limit));
  const page = options.page;
  return {
    products,
    paginated: true,
    pagination: {
      page,
      limit: options.limit,
      total,
      totalPages,
      hasNextPage: page < totalPages,
      hasPrevPage: page > 1,
    },
  };
}
