import { Router } from 'express';
import { getWishlist, toggleWishlist } from '../controllers/wishlistController';
import { protect } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { createAdaptiveLimiter } from '../middleware/adaptiveRateLimit';
import { getWishlistQuerySchema, toggleWishlistSchema } from '../validation/wishlistSchemas';

const router = Router();

const wishlistToggleLimiter = createAdaptiveLimiter({
  windowMs: 60_000,
  max: 60,
  prefix: 'rl:wishlist:toggle:',
  message: 'Too many wishlist updates. Please wait a moment.',
});

const wishlistReadLimiter = createAdaptiveLimiter({
  windowMs: 60_000,
  max: 120,
  prefix: 'rl:wishlist:read:',
  message: 'Too many wishlist requests. Please wait a moment.',
});

router.use(protect);

router.get('/', wishlistReadLimiter, validate(getWishlistQuerySchema), getWishlist);
router.post('/:productId', wishlistToggleLimiter, validate(toggleWishlistSchema), toggleWishlist);

export default router;
