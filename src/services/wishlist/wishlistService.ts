import mongoose from 'mongoose';
import Wishlist from '../../models/Wishlist';
import Product from '../../models/Product';
import AppError from '../../utils/AppError';
import logger from '../../utils/logger';
import { getRequestContext } from '../../utils/requestContext';
import { WISHLIST_MAX_ITEMS, WISHLIST_QUERY_MAX_MS } from './wishlistConstants';
import { wishlistCacheService } from './wishlistCacheService';
import { serializeWishlistProduct, serializeWishlistProducts, WishlistProductDto } from './wishlistDto';
import { recordWishlistMetric, recordProductWishlisted } from './wishlistMetricsService';
import { emitWishlistEvent } from './wishlistEventService';

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
  const exists = await Product.exists({ _id: productId }).maxTimeMS(WISHLIST_QUERY_MAX_MS);
  if (!exists) {
    throw new AppError('Product not found.', 404);
  }
}

async function fetchWishlistProductsOrdered(
  userId: string,
  options: WishlistListOptions
): Promise<{ products: RawWishlistProduct[]; total: number }> {
  const userObjectId = new mongoose.Types.ObjectId(userId);
  const skip = (options.page - 1) * options.limit;

  const pipeline: mongoose.PipelineStage[] = [
    { $match: { user: userObjectId } },
    {
      $project: {
        products: 1,
        totalProducts: { $size: { $ifNull: ['$products', []] } },
      },
    },
  ];

  if (options.paginated) {
    pipeline.push({
      $project: {
        totalProducts: 1,
        products: { $slice: ['$products', skip, options.limit] },
      },
    });
  }

  pipeline.push(
    {
      $lookup: {
        from: 'products',
        let: { productIds: '$products' },
        pipeline: [
          {
            $match: {
              $expr: { $in: ['$_id', '$$productIds'] },
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
              isActive: 1,
              totalStock: 1,
              variants: { stock: 1 },
            },
          },
        ],
        as: 'productDocs',
      },
    },
    {
      $addFields: {
        products: {
          $filter: {
            input: {
              $map: {
                input: '$products',
                as: 'pid',
                in: {
                  $first: {
                    $filter: {
                      input: '$productDocs',
                      as: 'doc',
                      cond: { $eq: ['$$doc._id', '$$pid'] },
                    },
                  },
                },
              },
            },
            as: 'item',
            cond: { $ne: ['$$item', null] },
          },
        },
      },
    },
    { $project: { products: 1, totalProducts: 1 } }
  );

  const rows = await Wishlist.aggregate(pipeline).option({ maxTimeMS: WISHLIST_QUERY_MAX_MS });
  const row = rows[0] as { products?: RawWishlistProduct[]; totalProducts?: number } | undefined;

  return {
    products: row?.products ?? [],
    total: row?.totalProducts ?? 0,
  };
}

export const wishlistService = {
  async getWishlist(userId: string, options: WishlistListOptions): Promise<WishlistListResult> {
    const page = options.paginated ? options.page : undefined;
    const limit = options.paginated ? options.limit : undefined;

    const cached = await wishlistCacheService.getList(userId, page, limit);
    if (cached) {
      recordWishlistMetric('wishlist.fetch.cache_hit', { userId });
      const total = cached.total ?? cached.products.length;
      return buildListResult(cached.products, options, total);
    }

    recordWishlistMetric('wishlist.fetch.cache_miss', { userId });

    const { products: rawProducts, total } = await fetchWishlistProductsOrdered(userId, options);
    const products = serializeWishlistProducts(rawProducts);

    await wishlistCacheService.setList(userId, { products, total }, page, limit);
    await wishlistCacheService.setCount(userId, total);

    recordWishlistMetric('wishlist.fetch', { userId, count: products.length });

    return buildListResult(products, options, total);
  },

  async toggleProduct(
    userId: string,
    productId: string
  ): Promise<{ wishlistCount: number; action: 'added' | 'removed' }> {
    const normalizedId = productId.trim();
    await assertProductExists(normalizedId);

    const productObjectId = new mongoose.Types.ObjectId(normalizedId);
    const userObjectId = new mongoose.Types.ObjectId(userId);
    const ctx = getRequestContext();

    const removed = await Wishlist.findOneAndUpdate(
      { user: userObjectId, products: productObjectId },
      { $pull: { products: productObjectId } },
      { new: true, projection: { products: 1 }, maxTimeMS: WISHLIST_QUERY_MAX_MS }
    ).lean();

    if (removed) {
      const wishlistCount = removed.products?.length ?? 0;
      wishlistCacheService.scheduleInvalidate(userId);
      recordWishlistMetric('wishlist.toggle.removed', { userId, productId: normalizedId });
      emitWishlistEvent({
        userId,
        productId: normalizedId,
        action: 'removed',
        wishlistCount,
      });
      logger.info({
        msg: 'wishlist_toggle',
        wishlistAction: 'removed',
        userId,
        productId: normalizedId,
        wishlistCount,
        requestId: ctx?.requestId,
        traceId: ctx?.traceId,
      });
      return { wishlistCount, action: 'removed' };
    }

    const added = await Wishlist.findOneAndUpdate(
      {
        user: userObjectId,
        $expr: { $lt: [{ $size: { $ifNull: ['$products', []] } }, WISHLIST_MAX_ITEMS] },
      },
      {
        $addToSet: { products: productObjectId },
        $setOnInsert: { user: userObjectId },
      },
      {
        upsert: true,
        new: true,
        projection: { products: 1 },
        maxTimeMS: WISHLIST_QUERY_MAX_MS,
      }
    ).lean();

    if (!added) {
      const current = await Wishlist.findOne({ user: userObjectId })
        .select('products')
        .lean()
        .maxTimeMS(WISHLIST_QUERY_MAX_MS);

      const count = current?.products?.length ?? 0;
      if (count >= WISHLIST_MAX_ITEMS) {
        recordWishlistMetric('wishlist.toggle.cap_reached', { userId, productId: normalizedId });
        throw new AppError(`Wishlist cannot exceed ${WISHLIST_MAX_ITEMS} items.`, 400);
      }
      throw new AppError('Unable to update wishlist.', 500);
    }

    const wishlistCount = added.products?.length ?? 0;
    wishlistCacheService.scheduleInvalidate(userId);
    recordWishlistMetric('wishlist.toggle.added', { userId, productId: normalizedId });
    recordProductWishlisted(normalizedId);
    emitWishlistEvent({
      userId,
      productId: normalizedId,
      action: 'added',
      wishlistCount,
    });
    logger.info({
      msg: 'wishlist_toggle',
      wishlistAction: 'added',
      userId,
      productId: normalizedId,
      wishlistCount,
      requestId: ctx?.requestId,
      traceId: ctx?.traceId,
    });

    return { wishlistCount, action: 'added' };
  },
};

function buildListResult(
  products: WishlistProductDto[],
  options: WishlistListOptions,
  total: number
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
