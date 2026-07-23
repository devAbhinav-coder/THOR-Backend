import { Router } from 'express';
import {
  getPublicReviewInvite,
  submitReviewInvite,
} from '../controllers/reviewInviteController';
import { uploadReviewImages, processReviewImages } from '../middleware/upload';
import { assertReviewUploadSecurity } from '../middleware/reviewUploadSecurity';
import { createAdaptiveLimiter } from '../middleware/adaptiveRateLimit';
import { validate } from '../middleware/validate';
import { z } from 'zod';

const router = Router();

const tokenParam = z.object({
  params: z.object({
    token: z.string().trim().min(20).max(128),
  }),
});

const optionalBooleanFromString = z.preprocess(
  (val) => {
    if (val === undefined || val === null || val === '') return undefined;
    if (val === 'true' || val === true) return true;
    if (val === 'false' || val === false) return false;
    return val;
  },
  z.boolean().optional(),
);

const submitSchema = z.object({
  params: z.object({
    token: z.string().trim().min(20).max(128),
  }),
  body: z.object({
    productId: z
      .string()
      .trim()
      .regex(/^[a-fA-F0-9]{24}$/, 'Invalid product'),
    rating: z.coerce.number().int().min(1).max(5),
    title: z.string().trim().max(100).optional(),
    comment: z
      .string()
      .trim()
      .min(10)
      .max(1000)
      .transform((v) => v.replace(/\s+/g, ' ').trim()),
    displayName: z.string().trim().max(80).optional(),
    isAnonymous: optionalBooleanFromString,
  }),
});

const readLimiter = createAdaptiveLimiter({
  windowMs: 60_000,
  max: 60,
  prefix: 'rl:review-invite:read:',
  message: 'Too many requests. Please wait a moment.',
});

const submitLimiter = createAdaptiveLimiter({
  windowMs: 60 * 60 * 1000,
  max: 12,
  prefix: 'rl:review-invite:submit:',
  message: 'Too many submissions. Please try again later.',
});

router.get('/:token', readLimiter, validate(tokenParam), getPublicReviewInvite);
router.post(
  '/:token/submit',
  submitLimiter,
  uploadReviewImages,
  assertReviewUploadSecurity,
  processReviewImages,
  validate(submitSchema),
  submitReviewInvite,
);

export default router;
