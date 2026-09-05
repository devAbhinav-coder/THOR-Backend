import { Router } from 'express';
import {
  createCoupon,
  getAllCoupons,
  getCoupon,
  updateCoupon,
  deleteCoupon,
  archiveCoupon,
  validateCoupon,
  getEligibleCoupons,
  getPublicCoupons,
} from '../controllers/couponController';
import { protect, restrictTo, requireAdminTwoFactor } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { paginationGuard } from '../middleware/paginationGuard';
import { createAdaptiveLimiter } from '../middleware/adaptiveRateLimit';
import { uploadCouponBanner, processCouponBanner } from '../middleware/upload';
import {
  createCouponSchema,
  validateCouponSchema,
  eligibleCouponsQuerySchema,
  updateCouponSchema,
  couponIdParamsSchema,
} from '../validation/schemas';

const router = Router();

const couponValidateLimiter = createAdaptiveLimiter({
  windowMs: 60_000,
  max: 30,
  prefix: 'rl:coupon:validate:',
  message: 'Too many coupon validation attempts. Please wait a moment.',
});

const couponEligibleLimiter = createAdaptiveLimiter({
  windowMs: 60_000,
  max: 40,
  prefix: 'rl:coupon:eligible:',
  message: 'Too many requests. Please wait a moment.',
});

const couponPublicLimiter = createAdaptiveLimiter({
  windowMs: 60_000,
  max: 60,
  prefix: 'rl:coupon:public:',
  message: 'Too many requests. Please wait a moment.',
});

router.get('/public', couponPublicLimiter, getPublicCoupons);
router.post('/validate', protect, couponValidateLimiter, validate(validateCouponSchema), validateCoupon);
router.get(
  '/eligible',
  protect,
  couponEligibleLimiter,
  validate(eligibleCouponsQuerySchema),
  getEligibleCoupons
);

router.use(protect, restrictTo('admin'), requireAdminTwoFactor);

router.post(
  '/',
  uploadCouponBanner,
  processCouponBanner,
  validate(createCouponSchema),
  createCoupon
);
router.get('/', paginationGuard, getAllCoupons);
router.get('/:id', validate(couponIdParamsSchema), getCoupon);
router.patch('/:id/archive', validate(couponIdParamsSchema), archiveCoupon);
router.patch(
  '/:id',
  uploadCouponBanner,
  processCouponBanner,
  validate(updateCouponSchema),
  updateCoupon
);
router.delete('/:id', validate(couponIdParamsSchema), deleteCoupon);

export default router;
