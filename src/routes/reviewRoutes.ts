import { Router } from 'express';
import {
  getFeaturedReviews,
  getProductReviews,
  createReview,
  updateReview,
  deleteReview,
  voteHelpful,
  reportReview,
  canReviewProduct,
} from '../controllers/reviewController';
import { protect } from '../middleware/auth';
import { uploadReviewImages, processReviewImages } from '../middleware/upload';
import { assertReviewUploadSecurity } from '../middleware/reviewUploadSecurity';
import { validate } from '../middleware/validate';
import { createAdaptiveLimiter } from '../middleware/adaptiveRateLimit';
import {
  createReviewSchema,
  updateReviewSchema,
  reviewIdParamSchema,
  productIdParamSchema,
  getProductReviewsQuerySchema,
  reportReviewSchema,
} from '../validation/reviewSchemas';

const router = Router();

const reviewReadLimiter = createAdaptiveLimiter({
  windowMs: 60_000,
  max: 180,
  prefix: 'rl:reviews:read:',
  message: 'Too many review requests. Please wait a moment.',
});

const reviewCreateLimiter = createAdaptiveLimiter({
  windowMs: 60_000,
  max: 12,
  prefix: 'rl:reviews:create:',
  message: 'Too many review submissions. Please try again later.',
});

const reviewMutationLimiter = createAdaptiveLimiter({
  windowMs: 60_000,
  max: 40,
  prefix: 'rl:reviews:mutate:',
  message: 'Too many review actions. Please wait a moment.',
});

router.get('/featured', reviewReadLimiter, getFeaturedReviews);
router.get(
  '/product/:productId',
  reviewReadLimiter,
  validate(getProductReviewsQuerySchema),
  getProductReviews
);

router.use(protect);

router.get(
  '/product/:productId/can-review',
  reviewMutationLimiter,
  validate(productIdParamSchema),
  canReviewProduct
);

router.post(
  '/product/:productId',
  reviewCreateLimiter,
  uploadReviewImages,
  assertReviewUploadSecurity,
  processReviewImages,
  validate(createReviewSchema),
  createReview
);

router.patch(
  '/:id',
  reviewMutationLimiter,
  validate(updateReviewSchema),
  updateReview
);

router.delete(
  '/:id',
  reviewMutationLimiter,
  validate(reviewIdParamSchema),
  deleteReview
);

router.patch(
  '/:id/helpful',
  reviewMutationLimiter,
  validate(reviewIdParamSchema),
  voteHelpful
);

router.patch(
  '/:id/report',
  reviewMutationLimiter,
  validate(reportReviewSchema),
  reportReview
);

export default router;
