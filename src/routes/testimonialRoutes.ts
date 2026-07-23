import { Router } from 'express';
import {
  getPublicTestimonials,
  submitPublicTestimonial,
  getAdminTestimonials,
  createTestimonial,
  updateTestimonial,
  deleteTestimonial,
  approveTestimonial,
  rejectTestimonial,
} from '../controllers/testimonialController';
import { protect, restrictTo } from '../middleware/auth';
import { uploadReviewImages, processReviewImages } from '../middleware/upload';
import { assertReviewUploadSecurity } from '../middleware/reviewUploadSecurity';
import { createAdaptiveLimiter } from '../middleware/adaptiveRateLimit';

const router = Router();

const submitLimiter = createAdaptiveLimiter({
  windowMs: 60 * 60 * 1000,
  max: 8,
  prefix: 'rl:testimonial:submit:',
  message: 'Too many submissions. Please try again later.',
});

/** Public — no login (homepage feed). */
router.get('/', getPublicTestimonials);

/** Public share-link submit — no login. */
router.post(
  '/submit',
  submitLimiter,
  uploadReviewImages,
  assertReviewUploadSecurity,
  processReviewImages,
  submitPublicTestimonial
);

router.use(protect, restrictTo('admin'));

router.get('/admin', getAdminTestimonials);
router.post(
  '/',
  uploadReviewImages,
  assertReviewUploadSecurity,
  processReviewImages,
  createTestimonial
);
router.patch('/:id/approve', approveTestimonial);
router.patch('/:id/reject', rejectTestimonial);
router.patch(
  '/:id',
  uploadReviewImages,
  assertReviewUploadSecurity,
  processReviewImages,
  updateTestimonial
);
router.delete('/:id', deleteTestimonial);

export default router;
