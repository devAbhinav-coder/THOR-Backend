import { Types } from "mongoose";
import Review from "../../models/Review";
import Testimonial from "../../models/Testimonial";
import AppError from "../../types/utils/AppError";
import { ReviewStatus } from "../../types";
import { reviewCacheService } from "./reviewCacheService";
import { recordReviewMetric } from "./reviewMetricsService";
import { emitReviewEvent } from "./reviewEventService";
import { deleteCache } from "../cacheService";

export type ReviewModerationAction = "approve" | "hide" | "restore";

const TESTIMONIALS_HOME_CACHE = "cache:testimonials:home:v3";

function resolveProductObjectId(product: unknown): Types.ObjectId {
  if (product instanceof Types.ObjectId) return product;
  if (typeof product === "string" && Types.ObjectId.isValid(product)) {
    return new Types.ObjectId(product);
  }
  if (product && typeof product === "object" && "_id" in product) {
    const id = (product as { _id: unknown })._id;
    if (id instanceof Types.ObjectId) return id;
    if (typeof id === "string" && Types.ObjectId.isValid(id)) {
      return new Types.ObjectId(id);
    }
  }
  throw new AppError("Review is missing a valid product.", 500);
}

async function syncLinkedTestimonial(
  reviewId: string,
  action: ReviewModerationAction,
): Promise<void> {
  const story = await Testimonial.findOne({ linkedReview: reviewId });
  if (!story) return;

  if (action === "approve" || action === "restore") {
    story.status = "approved";
    story.isActive = true;
    story.showOnHome = true;
  } else if (action === "hide") {
    story.status = "rejected";
    story.isActive = false;
    story.showOnHome = false;
  }
  await story.save();
  await deleteCache(TESTIMONIALS_HOME_CACHE);
}

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
  const productOid = resolveProductObjectId(review.product);
  const productId = String(productOid);

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

  await syncLinkedTestimonial(reviewId, action);

  reviewCacheService.scheduleInvalidateProduct(productId);
  reviewCacheService.scheduleInvalidateFeatured();

  await (
    Review as typeof Review & {
      calcAverageRatings: (id: Types.ObjectId) => Promise<void>;
    }
  ).calcAverageRatings(productOid);

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
