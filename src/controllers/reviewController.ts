import { Response, NextFunction } from "express";
import catchAsync from "../types/utils/catchAsync";
import { AuthRequest } from "../types";
import { sendPaginated, sendSuccess } from "../types/utils/response";
import { reviewService } from "../services/reviews/reviewService";
import type { ReportReason } from "../services/reviews/reviewConstants";

export const getFeaturedReviews = catchAsync(
  async (_req: AuthRequest, res: Response) => {
    const payload = await reviewService.getFeaturedReviews();
    sendSuccess(res, payload);
  },
);

export const getProductReviews = catchAsync(
  async (req: AuthRequest, res: Response) => {
    const { productId } = req.params;
    const page = Number(req.query.page) || 1;
    const limit = Number(req.query.limit) || 10;
    const sort =
      typeof req.query.sort === "string" ? req.query.sort : undefined;

    const result = await reviewService.getProductReviews(
      productId,
      page,
      limit,
      sort,
    );

    sendPaginated(
      res,
      {
        reviews: result.reviews,
        ratingDistribution: result.ratingDistribution,
      },
      { page: result.page, limit: result.limit, total: result.total },
    );
  },
);

export const createReview = catchAsync(
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    const { productId } = req.params;
    const { rating, title, comment, orderId, idempotencyKey } = req.body as {
      rating: number;
      title?: string;
      comment: string;
      orderId: string;
      idempotencyKey?: string;
    };

    const uploadedImages = (
      req as AuthRequest & {
        uploadedImages?: { url: string; publicId: string }[];
      }
    ).uploadedImages;

    const headerIdempotency = req.get("Idempotency-Key")?.trim();
    const effectiveIdempotencyKey = idempotencyKey || headerIdempotency;

    try {
      const review = await reviewService.createReview({
        userId: String(req.user!._id),
        productId,
        orderId,
        rating,
        title,
        comment,
        images:
          uploadedImages && uploadedImages.length > 0 ?
            uploadedImages.map((img) => ({
              url: img.url,
              publicId: img.publicId,
            }))
          : undefined,
        idempotencyKey: effectiveIdempotencyKey,
      });

      sendSuccess(res, { review }, "Review created", 201);
    } catch (err) {
      next(err);
    }
  },
);

export const updateReview = catchAsync(
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const review = await reviewService.updateReview(
        String(req.user!._id),
        req.params.id,
        {
          rating: req.body.rating,
          title: req.body.title,
          comment: req.body.comment,
        },
      );
      sendSuccess(res, { review });
    } catch (err) {
      next(err);
    }
  },
);

export const deleteReview = catchAsync(
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      await reviewService.deleteReview(String(req.user!._id), req.params.id);
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  },
);

export const canReviewProduct = catchAsync(
  async (req: AuthRequest, res: Response) => {
    const result = await reviewService.canReviewProduct(
      String(req.user!._id),
      req.params.productId,
    );
    sendSuccess(res, result);
  },
);

export const voteHelpful = catchAsync(
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const result = await reviewService.voteHelpful(
        String(req.user!._id),
        req.params.id,
      );
      sendSuccess(res, result);
    } catch (err) {
      next(err);
    }
  },
);

export const reportReview = catchAsync(
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const { reportCount } = await reviewService.reportReview(
        String(req.user!._id),
        req.params.id,
        req.body.reason as ReportReason,
        req.body.details,
      );
      sendSuccess(res, { reportCount }, "Review reported successfully");
    } catch (err) {
      next(err);
    }
  },
);

/** Public share-link — no login. Pending until admin approves → then on PDP. */
export const submitPublicReview = catchAsync(
  async (req: AuthRequest, res: Response) => {
    const body = req.body as {
      productId: string;
      rating: number;
      title?: string;
      comment: string;
      displayName?: string;
      isAnonymous?: boolean | string;
      alsoAsStory?: boolean | string;
    };
    const uploadedImages = (
      req as AuthRequest & {
        uploadedImages?: { url: string; publicId: string }[];
      }
    ).uploadedImages;

    const result = await reviewService.createShareLinkReview({
      productId: body.productId,
      rating: Number(body.rating),
      title: body.title,
      comment: String(body.comment || ""),
      displayName: body.displayName,
      isAnonymous: body.isAnonymous === true || body.isAnonymous === "true",
      alsoAsStory: body.alsoAsStory === true || body.alsoAsStory === "true",
      images:
        uploadedImages && uploadedImages.length > 0
          ? uploadedImages.map((img) => ({
              url: img.url,
              publicId: img.publicId,
            }))
          : undefined,
    });

    sendSuccess(
      res,
      result,
      result.testimonialId
        ? "Thank you! Product review and story submitted for approval."
        : "Thank you! Your product review was submitted and will appear after approval.",
      201,
    );
  },
);
