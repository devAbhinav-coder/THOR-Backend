import { Response, NextFunction } from "express";
import Review from "../models/Review";
import Order from "../models/Order";
import AppError from "../utils/AppError";
import catchAsync from "../utils/catchAsync";
import { AuthRequest } from "../types";
import { sendPaginated, sendSuccess } from "../utils/response";

const maskName = (name: string): string => {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "Verified Buyer";
  return parts
    .map((part) =>
      part.length <= 1 ?
        `${part}*`
      : `${part[0]}${"*".repeat(Math.min(part.length - 1, 4))}`,
    )
    .join(" ");
};

const sanitizeReviewForPublic = (review: {
  toObject: () => Record<string, unknown>;
}): Record<string, unknown> => {
  const raw = review.toObject();
  const user = raw.user as { name?: string; avatar?: string } | undefined;
  return {
    ...raw,
    user: {
      ...(user || {}),
      name: maskName(user?.name || ""),
      badge: "Verified Buyer",
    },
  };
};

export const getFeaturedReviews = catchAsync(
  async (_req: AuthRequest, res: Response) => {
    const reviews = await Review.find({ rating: { $gte: 3 } })
      .sort("-createdAt")
      .limit(60)
      .populate("user", "name avatar")
      .populate("product", "name slug");

    sendSuccess(res, {
      reviews: reviews.map(sanitizeReviewForPublic),
      results: reviews.length,
    });
  },
);

export const getProductReviews = catchAsync(
  async (req: AuthRequest, res: Response) => {
    const page = parseInt((req.query.page as string) || "1", 10);
    const limit = parseInt((req.query.limit as string) || "10", 10);
    const skip = (page - 1) * limit;

    const [reviews, total] = await Promise.all([
      Review.find({ product: req.params.productId })
        .sort("-createdAt")
        .skip(skip)
        .limit(limit)
        .populate("user", "name avatar"),
      Review.countDocuments({ product: req.params.productId }),
    ]);

    const ratingDistribution = await Review.aggregate([
      { $match: { product: reviews[0]?.product } },
      { $group: { _id: "$rating", count: { $sum: 1 } } },
      { $sort: { _id: -1 } },
    ]);

    sendPaginated(
      res,
      { reviews: reviews.map(sanitizeReviewForPublic), ratingDistribution },
      { page, limit, total },
    );
  },
);

export const createReview = catchAsync(
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    const { productId } = req.params;
    const { rating, title, comment, orderId } = req.body;

    const order = await Order.findOne({
      _id: orderId,
      user: req.user!._id,
      status: "delivered",
      "items.product": productId,
    });

    if (!order) {
      return next(
        new AppError(
          "You can only review products you have purchased and received.",
          403,
        ),
      );
    }

    const existingReview = await Review.findOne({
      product: productId,
      user: req.user!._id,
    });
    if (existingReview) {
      return next(new AppError("You have already reviewed this product.", 409));
    }

    const reviewData: {
      product: string;
      user: string;
      order: string;
      rating: number;
      title?: string;
      comment: string;
      isVerifiedPurchase: boolean;
      images?: { url: string; publicId: string }[];
    } = {
      product: productId,
      user: String(req.user!._id),
      order: orderId,
      rating,
      title,
      comment,
      isVerifiedPurchase: true,
    };

    const uploadedImages = (
      req as AuthRequest & {
        uploadedImages?: { url: string; publicId: string }[];
      }
    ).uploadedImages;
    if (uploadedImages && uploadedImages.length > 0) {
      reviewData.images = uploadedImages.map((img) => ({
        url: img.url,
        publicId: img.publicId,
      }));
    }

    const review = await Review.create(reviewData);
    await review.populate("user", "name avatar");

    sendSuccess(res, { review }, "Review created", 201);
  },
);

export const updateReview = catchAsync(
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    const review = await Review.findOne({
      _id: req.params.id,
      user: req.user!._id,
    });
    if (!review) return next(new AppError("Review not found.", 404));

    const { rating, title, comment } = req.body;
    if (rating) review.rating = rating;
    if (title) review.title = title;
    if (comment) review.comment = comment;

    await review.save();

    sendSuccess(res, { review });
  },
);

export const deleteReview = catchAsync(
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    const review = await Review.findOneAndDelete({
      _id: req.params.id,
      user: req.user!._id,
    });

    if (!review) return next(new AppError("Review not found.", 404));

    res.status(204).end();
  },
);

export const canReviewProduct = catchAsync(
  async (req: AuthRequest, res: Response) => {
    const { productId } = req.params;
    const [order, existingReview] = await Promise.all([
      Order.findOne({
        user: req.user!._id,
        status: "delivered",
        "items.product": productId,
      }),
      Review.findOne({ product: productId, user: req.user!._id }),
    ]);
    sendSuccess(res, {
      canReview: !!order && !existingReview,
      hasPurchased: !!order,
      hasReviewed: !!existingReview,
      orderId: order?._id || null,
    });
  },
);

export const voteHelpful = catchAsync(
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    const review = await Review.findById(req.params.id);
    if (!review) return next(new AppError("Review not found.", 404));

    const userId = req.user!._id;
    const alreadyVoted = review.helpfulVotes.some(
      (id) => id.toString() === String(userId),
    );

    if (alreadyVoted) {
      review.helpfulVotes = review.helpfulVotes.filter(
        (id) => id.toString() !== String(userId),
      );
    } else {
      review.helpfulVotes.push(userId);
    }

    await review.save();

    sendSuccess(res, {
      helpfulCount: review.helpfulVotes.length,
      voted: !alreadyVoted,
    });
  },
);

export const reportReview = catchAsync(
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    const review = await Review.findById(req.params.id);
    if (!review) return next(new AppError("Review not found.", 404));

    const userId = String(req.user!._id);
    const reason = String(req.body.reason || "")
      .trim()
      .toLowerCase();
    const details =
      typeof req.body.details === "string" ? req.body.details.trim() : "";

    const allowedReasons = new Set(["spam", "abusive", "misleading", "other"]);
    if (!allowedReasons.has(reason)) {
      return next(new AppError("Please provide a valid report reason.", 400));
    }
    if (details.length > 300) {
      return next(
        new AppError("Report details cannot exceed 300 characters.", 400),
      );
    }

    const hasAlreadyReported = (review.reports || []).some(
      (r) => String(r.user) === userId,
    );
    if (hasAlreadyReported) {
      return next(new AppError("You have already reported this review.", 409));
    }

    review.reports = [
      ...(review.reports || []),
      {
        user: req.user!._id,
        reason: reason as "spam" | "abusive" | "misleading" | "other",
        details: details || undefined,
        createdAt: new Date(),
      },
    ];
    review.reportCount = review.reports.length;
    await review.save();

    sendSuccess(
      res,
      { reportCount: review.reportCount },
      "Review reported successfully",
    );
  },
);
