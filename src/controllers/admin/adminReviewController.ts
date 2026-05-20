import { Request, Response, NextFunction } from 'express';
import catchAsync from '../../utils/catchAsync';
import { sendPaginated, sendSuccess } from '../../utils/response';
import { writeAdminAudit } from '../../services/adminAuditService';
import {
  adminReviewService,
  ADMIN_MODERATION_MESSAGES,
  AdminReviewListStatus,
} from '../../services/reviews/adminReviewService';
import { ReviewModerationAction } from '../../services/reviews/reviewAdminModerationService';

export const getAllReviews = catchAsync(async (req: Request, res: Response) => {
  const page = Number(req.query.page) || 1;
  const limit = Number(req.query.limit) || 20;
  const status = (req.query.status as AdminReviewListStatus) || 'all';

  const result = await adminReviewService.listReviews(page, limit, status);

  sendPaginated(res, { reviews: result.reviews }, { page: result.page, limit: result.limit, total: result.total });
});

export const deleteReview = catchAsync(async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { productId } = await adminReviewService.hardDeleteReview(req.params.id);

    await writeAdminAudit(req, 'review.delete', {
      reviewId: req.params.id,
      productId,
    });

    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

export const replyToReview = catchAsync(async (req: Request, res: Response, next: NextFunction) => {
  try {
    const review = await adminReviewService.replyToReview(req.params.id, req.body.text);

    await writeAdminAudit(req, 'review.reply', { reviewId: req.params.id });

    sendSuccess(res, { review });
  } catch (err) {
    next(err);
  }
});

export const moderateReview = catchAsync(async (req: Request, res: Response, next: NextFunction) => {
  try {
    const action = req.body.action as ReviewModerationAction;
    const adminUserId = String((req as Request & { user?: { _id?: unknown } }).user?._id || '');

    const review = await adminReviewService.moderateReview(req.params.id, action, adminUserId);

    await writeAdminAudit(req, `review.moderate.${action}`, {
      reviewId: req.params.id,
      action,
      status: review.status,
      productId: review.product,
    });

    sendSuccess(res, { review }, ADMIN_MODERATION_MESSAGES[action]);
  } catch (err) {
    next(err);
  }
});
