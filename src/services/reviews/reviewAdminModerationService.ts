import { Types } from "mongoose";
import Review from "../../models/Review";
import AppError from "../../types/utils/AppError";
import { ReviewStatus } from "../../types";
import { reviewCacheService } from "./reviewCacheService";
import { recordReviewMetric } from "./reviewMetricsService";
import { emitReviewEvent } from "./reviewEventService";

export type ReviewModerationAction = "approve" | "hide" | "restore";

export async function moderateReviewByAdmin(
  reviewId: string,
  action: ReviewModerationAction,
  adminUserId: string,
): Promise<Record<string, unknown>> {
  const review = await Review.findById(reviewId)
    .populate("user", "name email avatar")
    .populate("product", "name slug images");

  if (!review) throw new AppError("Review not found.", 404);

  const previousStatus = (review.status || "visible") as ReviewStatus;
  const productId = String(review.product);

  switch (action) {
    case "approve":
      review.status = "visible";
      review.deletedAt = null;
      break;
    case "hide":
      review.status = "hidden";
      if (!review.deletedAt) review.deletedAt = new Date();
      break;
    case "restore":
      review.status = "visible";
      review.deletedAt = null;
      break;
    default:
      throw new AppError("Invalid moderation action.", 400);
  }

  await review.save();

  reviewCacheService.scheduleInvalidateProduct(productId);
  reviewCacheService.scheduleInvalidateFeatured();

  await (
    Review as typeof Review & {
      calcAverageRatings: (id: Types.ObjectId) => Promise<void>;
    }
  ).calcAverageRatings(review.product as Types.ObjectId);

  recordReviewMetric("review.moderation.flagged", {
    reviewId,
    productId,
    action,
    adminUserId,
    previousStatus,
    nextStatus: review.status,
  });

  emitReviewEvent({
    type: "review.moderated",
    reviewId,
    productId,
    userId: adminUserId,
    meta: { action, previousStatus, nextStatus: review.status },
  });

  return review.toObject() as unknown as Record<string, unknown>;
}
