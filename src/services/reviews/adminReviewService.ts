import { Types } from "mongoose";
import Review from "../../models/Review";
import AppError from "../../types/utils/AppError";
import { reviewCacheService } from "./reviewCacheService";
import { REVIEW_QUERY_MAX_MS } from "./reviewConstants";
import {
  moderateReviewByAdmin,
  ReviewModerationAction,
} from "./reviewAdminModerationService";
import { emitReviewEvent } from "./reviewEventService";
import { recordReviewMetric } from "./reviewMetricsService";

export type AdminReviewListStatus =
  | "all"
  | "visible"
  | "hidden"
  | "flagged"
  | "pending_moderation";

function buildAdminListFilter(
  status: AdminReviewListStatus,
): Record<string, unknown> {
  if (status === "all") return {};
  if (status === "flagged") {
    return { status: { $in: ["flagged", "pending_moderation"] } };
  }
  if (status === "hidden") {
    return {
      $or: [{ status: "hidden" }, { deletedAt: { $ne: null } }],
    };
  }
  return { status };
}

export const adminReviewService = {
  async listReviews(
    page: number,
    limit: number,
    status: AdminReviewListStatus = "all",
  ): Promise<{
    reviews: Record<string, unknown>[];
    page: number;
    limit: number;
    total: number;
  }> {
    const skip = (page - 1) * limit;
    const filter = buildAdminListFilter(status);

    const [reviews, total] = await Promise.all([
      Review.find(filter)
        .sort("-createdAt")
        .skip(skip)
        .limit(limit)
        .select(
          "rating title comment images createdAt updatedAt user product order adminReply status deletedAt reportCount moderationFlags moderationScore helpfulCount helpfulVotes isVerifiedPurchase",
        )
        .populate("user", "name email avatar")
        .populate("product", "name slug images")
        .maxTimeMS(REVIEW_QUERY_MAX_MS)
        .lean(),
      Review.countDocuments(filter).maxTimeMS(REVIEW_QUERY_MAX_MS),
    ]);

    recordReviewMetric("review.featured.fetch", {
      scope: "admin_list",
      status,
      page,
    });

    return {
      reviews: reviews as Record<string, unknown>[],
      page,
      limit,
      total,
    };
  },

  async hardDeleteReview(reviewId: string): Promise<{ productId: string }> {
    const review = await Review.findByIdAndDelete(reviewId);
    if (!review) throw new AppError("Review not found.", 404);

    const productId = String(review.product);
    reviewCacheService.scheduleInvalidateProduct(productId);
    reviewCacheService.scheduleInvalidateFeatured();

    await (
      Review as typeof Review & {
        calcAverageRatings: (id: Types.ObjectId) => Promise<void>;
      }
    ).calcAverageRatings(review.product as Types.ObjectId);

    recordReviewMetric("review.deleted", {
      scope: "admin",
      reviewId,
      productId,
    });

    emitReviewEvent({
      type: "review.deleted",
      reviewId,
      productId,
      meta: { hardDelete: true },
    });

    return { productId };
  },

  async replyToReview(
    reviewId: string,
    text: string,
  ): Promise<Record<string, unknown>> {
    const trimmed = text.trim();
    if (!trimmed) throw new AppError("Reply text is required.", 400);
    if (trimmed.length > 500) {
      throw new AppError("Reply cannot exceed 500 characters.", 400);
    }

    const review = await Review.findByIdAndUpdate(
      reviewId,
      { adminReply: { text: trimmed, createdAt: new Date() } },
      { new: true },
    )
      .populate("user", "name avatar")
      .populate("product", "name slug images")
      .maxTimeMS(REVIEW_QUERY_MAX_MS);

    if (!review) throw new AppError("Review not found.", 404);

    reviewCacheService.scheduleInvalidateProduct(String(review.product));
    reviewCacheService.scheduleInvalidateFeatured();

    return review.toObject() as unknown as Record<string, unknown>;
  },

  moderateReview(
    reviewId: string,
    action: ReviewModerationAction,
    adminUserId: string,
  ): Promise<Record<string, unknown>> {
    return moderateReviewByAdmin(reviewId, action, adminUserId);
  },
};

export const ADMIN_MODERATION_MESSAGES: Record<ReviewModerationAction, string> =
  {
    approve: "Review approved and is now visible",
    hide: "Review hidden from the storefront",
    restore: "Review restored and is now visible",
  };
