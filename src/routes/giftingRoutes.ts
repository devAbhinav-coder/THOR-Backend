import { Router } from 'express';
import { protect, restrictTo } from '../middleware/auth';
import {
  getGiftableProducts,
  getGiftCategories,
  submitGiftingRequest,
  getMyGiftingRequests,
  getGiftingRequestById,
  getGiftingRequests,
  updateGiftingRequest,
  userRespondToQuote,
} from '../controllers/giftingController';
import { uploadGiftingImages, processGiftingImages } from '../middleware/upload';
import { validate } from '../middleware/validate';
import {
  submitGiftingRequestSchema,
  giftingAdminUpdateSchema,
  giftingRespondSchema,
} from '../validation/schemas';

const router = Router();

// Public (no auth required)
router.get('/products', getGiftableProducts);
router.get('/categories', getGiftCategories);

// User (auth required) — protect ensures req.user is always set
// This is critical: without protect, req.user is undefined and giftRequest.user won't be stored.
// That breaks getMyGiftingRequests and all user notifications.
router.post(
  '/requests',
  protect,
  uploadGiftingImages,
  processGiftingImages,
  validate(submitGiftingRequestSchema),
  submitGiftingRequest
);
router.get('/my-requests', protect, getMyGiftingRequests);
router.get('/requests/:id', protect, getGiftingRequestById);
router.post('/requests/:id/respond', protect, validate(giftingRespondSchema), userRespondToQuote);

// Admin
router.get('/requests', protect, restrictTo('admin'), getGiftingRequests);
router.patch(
  '/requests/:id',
  protect,
  restrictTo('admin'),
  validate(giftingAdminUpdateSchema),
  updateGiftingRequest
);

export default router;
