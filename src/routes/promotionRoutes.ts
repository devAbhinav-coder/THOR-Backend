import { Router } from 'express';
import {
  createPromotion,
  getAllPromotions,
  getPromotion,
  updatePromotion,
  deletePromotion,
  archivePromotion,
  previewPromotion,
  getPublicPromotionsHandler,
} from '../controllers/promotionController';
import { protect, restrictTo, requireAdminTwoFactor } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { paginationGuard } from '../middleware/paginationGuard';
import { createAdaptiveLimiter } from '../middleware/adaptiveRateLimit';
import { uploadPromotionBanner, processPromotionBanner } from '../middleware/upload';
import {
  createPromotionSchema,
  updatePromotionSchema,
  promotionIdParamsSchema,
  previewPromotionSchema,
} from '../validation/promotionSchemas';

const router = Router();

const promotionPublicLimiter = createAdaptiveLimiter({
  windowMs: 60_000,
  max: 60,
  prefix: 'rl:promotion:public:',
  message: 'Too many requests. Please wait a moment.',
});

router.get('/public', promotionPublicLimiter, getPublicPromotionsHandler);

router.use(protect, restrictTo('admin'), requireAdminTwoFactor);

router.post('/preview', validate(previewPromotionSchema), previewPromotion);
router.post(
  '/',
  uploadPromotionBanner,
  processPromotionBanner,
  validate(createPromotionSchema),
  createPromotion,
);
router.get('/', paginationGuard, getAllPromotions);
router.get('/:id', validate(promotionIdParamsSchema), getPromotion);
router.patch('/:id/archive', validate(promotionIdParamsSchema), archivePromotion);
router.patch(
  '/:id',
  uploadPromotionBanner,
  processPromotionBanner,
  validate(updatePromotionSchema),
  updatePromotion,
);
router.delete('/:id', validate(promotionIdParamsSchema), deletePromotion);

export default router;
