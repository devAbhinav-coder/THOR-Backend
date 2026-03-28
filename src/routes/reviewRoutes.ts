import { Router } from 'express';
import {
  getFeaturedReviews,
  getProductReviews,
  createReview,
  updateReview,
  deleteReview,
  voteHelpful,
  canReviewProduct,
} from '../controllers/reviewController';
import { protect } from '../middleware/auth';
import { uploadReviewImages, processReviewImages } from '../middleware/upload';
import { validate } from '../middleware/validate';
import { createReviewSchema } from '../validation/schemas';

const router = Router();

router.get('/featured', getFeaturedReviews);
router.get('/product/:productId', getProductReviews);

router.use(protect);

router.get('/product/:productId/can-review', canReviewProduct);

router.post('/product/:productId', uploadReviewImages, processReviewImages, validate(createReviewSchema), createReview);
router.patch('/:id', updateReview);
router.delete('/:id', deleteReview);
router.patch('/:id/helpful', voteHelpful);

export default router;
