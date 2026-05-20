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
} from '../controllers/couponController';
import { protect, restrictTo } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { paginationGuard } from '../middleware/paginationGuard';
import { createAdaptiveLimiter } from '../middleware/adaptiveRateLimit';
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

router.post('/validate', protect, couponValidateLimiter, validate(validateCouponSchema), validateCoupon);
router.get(
  '/eligible',
  protect,
  couponEligibleLimiter,
  validate(eligibleCouponsQuerySchema),
  getEligibleCoupons
);

router.use(protect, restrictTo('admin'));

router.post('/', validate(createCouponSchema), createCoupon);
router.get('/', paginationGuard, getAllCoupons);
router.get('/:id', validate(couponIdParamsSchema), getCoupon);
router.patch('/:id/archive', validate(couponIdParamsSchema), archiveCoupon);
router.patch('/:id', validate(updateCouponSchema), updateCoupon);
router.delete('/:id', validate(couponIdParamsSchema), deleteCoupon);

export default router;
