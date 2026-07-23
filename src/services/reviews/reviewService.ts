import mongoose, { Types } from "mongoose";
import crypto from "crypto";
import Review from "../../models/Review";
import { IReview } from "../../types";
import Order from "../../models/Order";
import Product from "../../models/Product";
import User from "../../models/User";
import AppError from "../../types/utils/AppError";
import { runInTransaction } from "../../types/utils/mongoTransaction";
import { getCache, setCache } from "../cacheService";
import { OFFLINE_MANUAL_PRODUCT_TAG } from "../../constants/offlineOrder";
import {
  PUBLIC_REVIEW_FILTER,
  REVIEW_EDIT_WINDOW_DAYS,
  REVIEW_IDEMPOTENCY_TTL_SEC,
  REVIEW_QUERY_MAX_MS,
  REVIEW_SORT_OPTIONS,
  ReviewSortKey,
  reviewIdempotencyCacheKey,
} from "./reviewConstants";
import { reviewCacheService } from "./reviewCacheService";
import {
  serializeReviewForOwner,
  serializeReviewsForPublic,
} from "./reviewDto";
import { emitReviewEvent } from "./reviewEventService";
import { recordReviewMetric } from "./reviewMetricsService";
import {
  applyModerationToReview,
  enqueueModerationReview,
} from "./reviewModerationService";
import { recordProductReviewAnalytics } from "./reviewAnalyticsService";
import { testimonialService } from "../testimonialService";
import type { ReportReason } from "./reviewConstants";

function isDuplicateKeyError(err: unknown): boolean {
  return (
    err !== null &&
    typeof err === "object" &&
    "code" in err &&
    (err as { code: number }).code === 11000
  );
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function buildListFilter(
  productId: string,
  sort: ReviewSortKey,
): Record<string, unknown> {
  const filter: Record<string, unknown> = {
    product: productId,
    ...PUBLIC_REVIEW_FILTER,
  };
  if (sort === "images") {
    filter["images.0"] = { $exists: true };
  }
  return filter;
}

function parseSort(sortRaw?: string): ReviewSortKey {
  const allowed: ReviewSortKey[] = ["newest", "highest", "helpful", "images"];
  if (sortRaw && allowed.includes(sortRaw as ReviewSortKey)) {
    return sortRaw as ReviewSortKey;
  }
  return "newest";
}

async function resolveProductReviewTotal(productId: string): Promise<number> {
  const product = await Product.findById(productId)
    .select("ratings.count")
    .lean()
    .maxTimeMS(REVIEW_QUERY_MAX_MS);
  if (product?.ratings?.count !== undefined && product.ratings.count >= 0) {
    return product.ratings.count;
  }
  return Review.countDocuments({
    product: productId,
    ...PUBLIC_REVIEW_FILTER,
  }).maxTimeMS(REVIEW_QUERY_MAX_MS);
}

async function fetchRatingDistribution(
  productId: string,
): Promise<{ _id: number; count: number }[]> {
  const cached = await reviewCacheService.getRatingSummary(productId);
  if (cached) return cached.ratingDistribution;

  const distribution = await Review.aggregate([
    {
      $match: {
        product: new Types.ObjectId(productId),
        ...PUBLIC_REVIEW_FILTER,
      },
    },
    { $group: { _id: "$rating", count: { $sum: 1 } } },
    { $sort: { _id: -1 } },
  ]).option({ maxTimeMS: REVIEW_QUERY_MAX_MS });

  const total = distribution.reduce((sum, row) => sum + row.count, 0);
  reviewCacheService
    .setRatingSummary(productId, { ratingDistribution: distribution, total })
    .catch(() => {});

  return distribution;
}

async function loadUserSnapshot(
  userId: string,
): Promise<{ name?: string; avatar?: string }> {
  const user = await User.findById(userId)
    .select("name avatar")
    .lean()
    .maxTimeMS(REVIEW_QUERY_MAX_MS);
  if (!user) return { name: "Verified Buyer" };
  const name =
    typeof user.name === "string" && user.name.trim().length > 0 ?
      user.name.trim()
    : "Verified Buyer";
  return { name, ...(user.avatar ? { avatar: user.avatar } : {}) };
}

export const reviewService = {
  async getFeaturedReviews(): Promise<{
    reviews: Record<string, unknown>[];
    results: number;
  }> {
    const cached = await reviewCacheService.getFeatured();
    if (cached) {
      recordReviewMetric("review.featured.cache_hit");
      return cached;
    }
    recordReviewMetric("review.featured.cache_miss");

    const reviews = await Review.find({
      rating: { $gte: 3 },
      ...PUBLIC_REVIEW_FILTER,
    })
      .sort({ createdAt: -1 })
      .limit(60)
      .select(
        "rating title comment images isVerifiedPurchase helpfulCount helpfulVotes createdAt user userSnapshot product",
      )
      .populate("user", "name avatar")
      .populate("product", "name slug")
      .maxTimeMS(REVIEW_QUERY_MAX_MS)
      .lean();

    const payload = {
      reviews: serializeReviewsForPublic(
        reviews as Parameters<typeof serializeReviewsForPublic>[0],
      ),
      results: reviews.length,
    };

    reviewCacheService.setFeatured(payload).catch(() => {});
    recordReviewMetric("review.featured.fetch");
    return payload;
  },

  async getProductReviews(
    productId: string,
    page: number,
    limit: number,
    sortRaw?: string,
  ): Promise<{
    reviews: Record<string, unknown>[];
    ratingDistribution: { _id: number; count: number }[];
    total: number;
    page: number;
    limit: number;
  }> {
    const sort = parseSort(sortRaw);
    const skip = (page - 1) * limit;

    const cached = await reviewCacheService.getProductPage(
      productId,
      page,
      limit,
      sort,
    );
    if (cached) {
      recordReviewMetric("review.product.cache_hit", { productId, sort });
      return { ...cached, page, limit };
    }
    recordReviewMetric("review.product.cache_miss", { productId, sort });

    const filter = buildListFilter(productId, sort);
    const sortSpec = REVIEW_SORT_OPTIONS[sort];

    const [reviews, total, ratingDistribution] = await Promise.all([
      Review.find(filter)
        .sort(sortSpec)
        .skip(skip)
        .limit(limit)
        .select(
          "rating title comment images isVerifiedPurchase helpfulCount helpfulVotes createdAt user userSnapshot adminReply reports reportCount",
        )
        .populate("user", "name avatar")
        .maxTimeMS(REVIEW_QUERY_MAX_MS)
        .lean(),
      resolveProductReviewTotal(productId),
      fetchRatingDistribution(productId),
    ]);

    const serialized = serializeReviewsForPublic(
      reviews as Parameters<typeof serializeReviewsForPublic>[0],
    );

    const payload = {
      reviews: serialized,
      ratingDistribution,
      total,
      page,
      limit,
    };

    reviewCacheService
      .setProductPage(productId, page, limit, sort, {
        reviews: serialized,
        ratingDistribution,
        total,
      })
      .catch(() => {});

    recordReviewMetric("review.product.list", { productId, sort, page });
    return payload;
  },

  async canReviewProduct(
    userId: string,
    productId: string,
  ): Promise<{
    canReview: boolean;
    hasPurchased: boolean;
    hasReviewed: boolean;
    orderId: string | null;
  }> {
    const [order, existingReview] = await Promise.all([
      Order.findOne({
        user: userId,
        status: "delivered",
        "items.product": productId,
      })
        .select("_id")
        .lean()
        .maxTimeMS(REVIEW_QUERY_MAX_MS),
      Review.findOne({ product: productId, user: userId })
        .select("_id")
        .lean()
        .maxTimeMS(REVIEW_QUERY_MAX_MS),
    ]);

    const hasReviewed = !!existingReview;

    return {
      canReview: !!order && !hasReviewed,
      hasPurchased: !!order,
      hasReviewed,
      orderId: order?._id ? String(order._id) : null,
    };
  },

  async createReview(input: {
    userId: string;
    productId: string;
    orderId: string;
    rating: number;
    title?: string;
    comment: string;
    images?: { url: string; publicId: string }[];
    idempotencyKey?: string;
  }): Promise<Record<string, unknown>> {
    const { userId, productId, orderId, rating, images, idempotencyKey } =
      input;
    const title = input.title ? normalizeWhitespace(input.title) : undefined;
    const comment = normalizeWhitespace(input.comment);

    if (idempotencyKey) {
      const cacheKey = reviewIdempotencyCacheKey(userId, idempotencyKey);
      const cached = await getCache<{ review: Record<string, unknown> }>(
        cacheKey,
      );
      if (cached?.review) {
        recordReviewMetric("review.idempotency.replay", { productId });
        return cached.review;
      }
    }

    const userSnapshot = await loadUserSnapshot(userId);

    let createdReview: Record<string, unknown>;

    try {
      createdReview = await runInTransaction(async (session) => {
        const order = await Order.findOne({
          _id: orderId,
          user: userId,
          status: "delivered",
          "items.product": productId,
        })
          .session(session)
          .select("_id");

        if (!order) {
          throw new AppError(
            "You can only review products you have purchased and received.",
            403,
          );
        }

        const reviewData = {
          product: productId,
          user: userId,
          order: orderId,
          rating,
          title,
          comment,
          isVerifiedPurchase: true,
          userSnapshot,
          status: "visible" as const,
          helpfulCount: 0,
          ...(images && images.length > 0 ? { images } : {}),
        };

        const [review] = await Review.create([reviewData], { session });
        applyModerationToReview(review, title, comment);
        await review.save({ session });

        const populated = await Review.findById(review._id)
          .session(session)
          .populate("user", "name avatar");
        return serializeReviewForOwner(
          populated as unknown as Parameters<typeof serializeReviewForOwner>[0],
        );
      }, "review.create");
    } catch (err) {
      if (isDuplicateKeyError(err)) {
        recordReviewMetric("review.duplicate_attempt", { productId, userId });
        throw new AppError("You have already reviewed this product.", 409);
      }
      throw err;
    }

    reviewCacheService.scheduleInvalidateProduct(productId);
    reviewCacheService.scheduleInvalidateFeatured();
    recordReviewMetric("review.created", { productId, userId, rating });
    recordProductReviewAnalytics(productId, "created", rating);

    const reviewId = String((createdReview as { _id?: unknown })._id);
    emitReviewEvent({
      type: "review.created",
      reviewId,
      productId,
      userId,
      meta: { rating },
    });

    const flags = (createdReview as { moderationFlags?: string[] })
      .moderationFlags;
    if (flags?.length) {
      enqueueModerationReview(reviewId, productId, flags);
    }

    if (idempotencyKey) {
      setCache(
        reviewIdempotencyCacheKey(userId, idempotencyKey),
        { review: createdReview },
        REVIEW_IDEMPOTENCY_TTL_SEC,
      ).catch(() => {});
    }

    return createdReview;
  },

  async updateReview(
    userId: string,
    reviewId: string,
    updates: { rating?: number; title?: string; comment?: string },
  ): Promise<Record<string, unknown>> {
    const review = await Review.findOne({
      _id: reviewId,
      user: userId,
      $or: [{ deletedAt: null }, { deletedAt: { $exists: false } }],
    });
    if (!review) throw new AppError("Review not found.", 404);

    const editDeadline = new Date(review.createdAt);
    editDeadline.setDate(editDeadline.getDate() + REVIEW_EDIT_WINDOW_DAYS);
    if (new Date() > editDeadline) {
      throw new AppError(
        `Reviews can only be edited within ${REVIEW_EDIT_WINDOW_DAYS} days of submission.`,
        403,
      );
    }

    if (updates.rating !== undefined) review.rating = updates.rating;
    if (updates.title !== undefined)
      review.title = normalizeWhitespace(updates.title);
    if (updates.comment !== undefined)
      review.comment = normalizeWhitespace(updates.comment);

    applyModerationToReview(review, review.title, review.comment);
    await review.save();

    const productId = String(review.product);
    reviewCacheService.scheduleInvalidateProduct(productId);
    reviewCacheService.scheduleInvalidateFeatured();
    recordReviewMetric("review.updated", { productId, userId, reviewId });

    return serializeReviewForOwner(
      review as unknown as Parameters<typeof serializeReviewForOwner>[0],
    );
  },

  async deleteReview(userId: string, reviewId: string): Promise<void> {
    const review = await Review.findOneAndUpdate(
      {
        _id: reviewId,
        user: userId,
        $or: [{ deletedAt: null }, { deletedAt: { $exists: false } }],
      },
      {
        deletedAt: new Date(),
        status: "hidden",
      },
      { new: true },
    );

    if (!review) throw new AppError("Review not found.", 404);

    const productId = String(review.product);
    reviewCacheService.scheduleInvalidateProduct(productId);
    reviewCacheService.scheduleInvalidateFeatured();
    recordReviewMetric("review.deleted", { productId, userId, reviewId });
    recordProductReviewAnalytics(productId, "deleted");

    emitReviewEvent({
      type: "review.deleted",
      reviewId,
      productId,
      userId,
    });

    await (
      Review as typeof Review & {
        calcAverageRatings: (id: Types.ObjectId) => Promise<void>;
      }
    ).calcAverageRatings(review.product as Types.ObjectId);
  },

  async voteHelpful(
    userId: string,
    reviewId: string,
  ): Promise<{ helpfulCount: number; voted: boolean }> {
    const userObjectId = new Types.ObjectId(userId);

    const existing = await Review.findOne({
      _id: reviewId,
      ...PUBLIC_REVIEW_FILTER,
      helpfulVotes: userObjectId,
    })
      .select("_id helpfulVotes helpfulCount product")
      .lean()
      .maxTimeMS(REVIEW_QUERY_MAX_MS);

    if (existing) {
      const updated = (await Review.findOneAndUpdate(
        { _id: reviewId, helpfulVotes: userObjectId },
        {
          $pull: { helpfulVotes: userObjectId },
          $inc: { helpfulCount: -1 },
        },
        { new: true },
      )
        .select("helpfulCount helpfulVotes product")
        .maxTimeMS(REVIEW_QUERY_MAX_MS)) as IReview | null;

      if (!updated) throw new AppError("Review not found.", 404);

      const helpfulCount = Math.max(
        0,
        updated.helpfulCount ?? updated.helpfulVotes?.length ?? 0,
      );
      recordReviewMetric("review.helpful.unvote", {
        reviewId,
        productId: String(updated.product),
        userId,
      });

      return { helpfulCount, voted: false };
    }

    const updated = (await Review.findOneAndUpdate(
      {
        _id: reviewId,
        ...PUBLIC_REVIEW_FILTER,
        helpfulVotes: { $ne: userObjectId },
      },
      {
        $addToSet: { helpfulVotes: userObjectId },
        $inc: { helpfulCount: 1 },
      },
      { new: true },
    )
      .select("helpfulCount helpfulVotes product")
      .maxTimeMS(REVIEW_QUERY_MAX_MS)) as IReview | null;

    if (!updated) throw new AppError("Review not found.", 404);

    const helpfulCount =
      updated.helpfulCount ?? updated.helpfulVotes?.length ?? 0;
    recordReviewMetric("review.helpful.vote", {
      reviewId,
      productId: String(updated.product),
      userId,
    });

    emitReviewEvent({
      type: "review.helpful_vote",
      reviewId,
      productId: String(updated.product),
      userId,
      meta: { helpfulCount },
    });

    return { helpfulCount, voted: true };
  },

  async reportReview(
    userId: string,
    reviewId: string,
    reason: ReportReason,
    details?: string,
  ): Promise<{ reportCount: number }> {
    const userObjectId = new Types.ObjectId(userId);
    const reportEntry = {
      user: userObjectId,
      reason,
      details: details || undefined,
      createdAt: new Date(),
    };

    const updated = (await Review.findOneAndUpdate(
      {
        _id: reviewId,
        ...PUBLIC_REVIEW_FILTER,
        "reports.user": { $ne: userObjectId },
      },
      {
        $push: { reports: reportEntry },
        $inc: { reportCount: 1 },
      },
      { new: true },
    )
      .select("reportCount product")
      .maxTimeMS(REVIEW_QUERY_MAX_MS)) as IReview | null;

    if (!updated) {
      const exists = await Review.exists({
        _id: reviewId,
        ...PUBLIC_REVIEW_FILTER,
      }).maxTimeMS(REVIEW_QUERY_MAX_MS);
      if (!exists) throw new AppError("Review not found.", 404);

      const already = await Review.exists({
        _id: reviewId,
        "reports.user": userObjectId,
      }).maxTimeMS(REVIEW_QUERY_MAX_MS);
      if (already)
        throw new AppError("You have already reported this review.", 409);
      throw new AppError("Review not found.", 404);
    }

    const reportCount = updated.reportCount ?? 0;
    const productId = String(updated.product);

    reviewCacheService.scheduleInvalidateProduct(productId);
    recordReviewMetric("review.reported", {
      reviewId,
      productId,
      userId,
      reason,
    });
    recordProductReviewAnalytics(productId, "reported");

    emitReviewEvent({
      type: "review.reported",
      reviewId,
      productId,
      userId,
      meta: { reason, reportCount },
    });

    return { reportCount };
  },

  /**
   * Public share-link review (no login). Goes to pending_moderation until admin approves,
   * then appears on the product page. Optionally also creates a homepage testimonial.
   */
  async createShareLinkReview(input: {
    productId: string;
    rating: number;
    title?: string;
    comment: string;
    displayName?: string;
    isAnonymous?: boolean;
    images?: { url: string; publicId: string }[];
    alsoAsStory?: boolean;
  }): Promise<{
    reviewId: string;
    status: string;
    testimonialId?: string;
  }> {
    const productId = String(input.productId || "").trim();
    if (!mongoose.Types.ObjectId.isValid(productId)) {
      throw new AppError("Invalid product.", 400);
    }

    const product = await Product.findOne({
      _id: productId,
      isActive: true,
      tags: { $nin: [OFFLINE_MANUAL_PRODUCT_TAG] },
    })
      .select("_id name")
      .lean()
      .maxTimeMS(REVIEW_QUERY_MAX_MS);

    if (!product) {
      throw new AppError("Product not found or not available for review.", 404);
    }

    const comment = normalizeWhitespace(input.comment);
    if (comment.length < 10) {
      throw new AppError("Please write at least 10 characters.", 400);
    }
    const title = input.title ? normalizeWhitespace(input.title) : undefined;
    const rating = Number(input.rating);
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
      throw new AppError("Rating must be between 1 and 5.", 400);
    }

    const anonymous =
      Boolean(input.isAnonymous) || !String(input.displayName || "").trim();
    const displayName = anonymous
      ? "Anonymous"
      : String(input.displayName).trim().slice(0, 80);

    const images =
      input.images && input.images.length > 0
        ? input.images.slice(0, 5)
        : undefined;

    if (input.alsoAsStory && (!images || images.length < 1)) {
      throw new AppError(
        "At least one photo is required to also share as a homepage story.",
        400,
      );
    }

    const guestEmail = `share_${crypto.randomBytes(12).toString("hex")}@review.local`;
    const guestPassword = crypto.randomBytes(24).toString("base64url");

    const guestUser = await User.create({
      name: displayName.slice(0, 50),
      email: guestEmail,
      password: guestPassword,
    });

    let reviewId = "";
    try {
      const [review] = await Review.create([
        {
          product: productId,
          user: guestUser._id,
          rating,
          title,
          comment,
          images,
          isVerifiedPurchase: false,
          source: "share_link",
          status: "pending_moderation",
          userSnapshot: { name: displayName },
          helpfulCount: 0,
        },
      ]);
      applyModerationToReview(review, title, comment);
      // Always keep share-link reviews pending until admin approve
      review.status = "pending_moderation";
      await review.save();
      reviewId = String(review._id);
    } catch (err) {
      await User.deleteOne({ _id: guestUser._id }).catch(() => {});
      if (isDuplicateKeyError(err)) {
        throw new AppError("You have already reviewed this product.", 409);
      }
      throw err;
    }

    reviewCacheService.scheduleInvalidateProduct(productId);
    recordReviewMetric("review.created", { productId, rating, source: "share_link" });
    emitReviewEvent({
      type: "review.created",
      reviewId,
      productId,
      userId: String(guestUser._id),
      meta: { rating, source: "share_link" },
    });

    let testimonialId: string | undefined;
    if (input.alsoAsStory) {
      const story = await testimonialService.submitFromPublicLink({
        displayName: anonymous ? "" : displayName,
        isAnonymous: anonymous,
        quote: comment.slice(0, 1200),
        rating,
        images: images!,
        productId,
      });
      testimonialId = String(story._id);
    }

    return {
      reviewId,
      status: "pending_moderation",
      ...(testimonialId ? { testimonialId } : {}),
    };
  },
};
