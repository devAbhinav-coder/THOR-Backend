import { Router } from 'express';
import {
  getCart,
  addToCart,
  uploadCustomFieldImage,
  updateCartItem,
  removeFromCart,
  clearCart,
  applyCoupon,
  removeCoupon,
  previewCartPromotion,
  previewBuyNowCheckout,
} from '../controllers/cartController';
import { cartSyncStream } from '../controllers/cartSyncController';
import { protect } from '../middleware/auth';
import { validate } from '../middleware/validate';
import {
  addToCartSchema,
  updateCartItemSchema,
  applyCouponSchema,
  previewCartPromotionSchema,
  previewBuyNowCheckoutSchema,
} from '../validation/cartSchemas';
import {
  uploadCartCustomFieldImage,
  processCartCustomFieldImage,
} from '../middleware/upload';
import { cartCouponLimiter, cartMutationLimiter } from '../middleware/cartRateLimit';

const router = Router();

router.use(protect);

router.get('/', getCart);
router.get('/sync', cartSyncStream);
router.post(
  '/custom-field-image',
  uploadCartCustomFieldImage,
  processCartCustomFieldImage,
  uploadCustomFieldImage
);
router.post('/add', cartMutationLimiter, validate(addToCartSchema), addToCart);
router.patch(
  '/item/:cartItemId',
  cartMutationLimiter,
  validate(updateCartItemSchema),
  updateCartItem
);
router.delete('/item/:cartItemId', removeFromCart);
router.delete('/', clearCart);
router.post(
  '/promotion-preview',
  validate(previewCartPromotionSchema),
  previewCartPromotion,
);
router.post(
  '/buy-now-preview',
  validate(previewBuyNowCheckoutSchema),
  previewBuyNowCheckout,
);
router.post('/apply-coupon', cartCouponLimiter, validate(applyCouponSchema), applyCoupon);
router.delete('/coupon', removeCoupon);

export default router;
