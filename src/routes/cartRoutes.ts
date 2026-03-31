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
} from '../controllers/cartController';
import { protect } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { addToCartSchema, updateCartItemSchema } from '../validation/schemas';
import { uploadGiftingImages, processGiftingImages } from '../middleware/upload';

const router = Router();

router.use(protect);

router.get('/', getCart);
router.post('/custom-field-image', uploadGiftingImages, processGiftingImages, uploadCustomFieldImage);
router.post('/add', validate(addToCartSchema), addToCart);
router.patch('/item/:sku', validate(updateCartItemSchema), updateCartItem);
router.delete('/item/:sku', removeFromCart);
router.delete('/', clearCart);
router.post('/apply-coupon', applyCoupon);
router.delete('/coupon', removeCoupon);

export default router;
