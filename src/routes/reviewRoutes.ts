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
  submitPublicReview,
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
  submitPublicReviewSchema,
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

const reviewPublicSubmitLimiter = createAdaptiveLimiter({
  windowMs: 60 * 60 * 1000,
  max: 8,
  prefix: 'rl:reviews:public-submit:',
  message: 'Too many submissions. Please try again later.',
});

router.get('/featured', reviewReadLimiter, getFeaturedReviews);
router.get(
  '/product/:productId',
  reviewReadLimiter,
  validate(getProductReviewsQuerySchema),
  getProductReviews
);

/** Share-link / QR — no login. Pending until admin approves. */
router.post(
  '/submit-public',
  reviewPublicSubmitLimiter,
  uploadReviewImages,
  assertReviewUploadSecurity,
  processReviewImages,
  validate(submitPublicReviewSchema),
  submitPublicReview
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
