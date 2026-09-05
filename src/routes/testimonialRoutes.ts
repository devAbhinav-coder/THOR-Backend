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
import { protect, restrictTo, requireAdminTwoFactor } from '../middleware/auth';
import { uploadReviewImages, processReviewImages } from '../middleware/upload';
import { assertReviewUploadSecurity } from '../middleware/reviewUploadSecurity';
import { createAdaptiveLimiter } from '../middleware/adaptiveRateLimit';
import { validate } from '../middleware/validate';
import {
  submitPublicTestimonialSchema,
  createTestimonialSchema,
  updateTestimonialSchema,
  testimonialIdParamSchema,
} from '../validation/testimonialSchemas';

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
  validate(submitPublicTestimonialSchema),
  submitPublicTestimonial
);

router.use(protect, restrictTo('admin'), requireAdminTwoFactor);

router.get('/admin', getAdminTestimonials);
router.post(
  '/',
  uploadReviewImages,
  assertReviewUploadSecurity,
  processReviewImages,
  validate(createTestimonialSchema),
  createTestimonial
);
router.patch('/:id/approve', validate(testimonialIdParamSchema), approveTestimonial);
router.patch('/:id/reject', validate(testimonialIdParamSchema), rejectTestimonial);
router.patch(
  '/:id',
  uploadReviewImages,
  assertReviewUploadSecurity,
  processReviewImages,
  validate(updateTestimonialSchema),
  updateTestimonial
);
router.delete('/:id', validate(testimonialIdParamSchema), deleteTestimonial);

export default router;
