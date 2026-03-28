import { Router } from 'express';
import {
  createCoupon,
  getAllCoupons,
  getCoupon,
  updateCoupon,
  deleteCoupon,
  validateCoupon,
  getEligibleCoupons,
} from '../controllers/couponController';
import { protect, restrictTo } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { createCouponSchema } from '../validation/schemas';

const router = Router();

router.post('/validate', protect, validateCoupon);
router.get('/eligible', protect, getEligibleCoupons);

router.use(protect, restrictTo('admin'));

router.post('/', validate(createCouponSchema), createCoupon);
router.get('/', getAllCoupons);
router.get('/:id', getCoupon);
router.patch('/:id', updateCoupon);
router.delete('/:id', deleteCoupon);

export default router;
