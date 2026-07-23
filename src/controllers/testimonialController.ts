import { Request, Response } from 'express';
import catchAsync from '../types/utils/catchAsync';
import { sendSuccess } from '../types/utils/response';
import { writeAdminAudit } from '../services/adminAuditService';
import { testimonialService } from '../services/testimonialService';
import { AuthRequest } from '../types';

export const getPublicTestimonials = catchAsync(async (_req: Request, res: Response) => {
  const testimonials = await testimonialService.listPublicForHome();
  sendSuccess(res, { testimonials });
});

/** Anyone with the share link — no login. Goes to pending until admin approves. */
export const submitPublicTestimonial = catchAsync(async (req: Request, res: Response) => {
  const uploaded = (req as Request & { uploadedImages?: { url: string; publicId: string }[] })
    .uploadedImages;
  const body = req.body as Record<string, unknown>;

  const testimonial = await testimonialService.submitFromPublicLink({
    displayName: body.displayName as string | undefined,
    isAnonymous: body.isAnonymous === true || body.isAnonymous === 'true',
    quote: String(body.quote || ''),
    rating: body.rating !== undefined ? Number(body.rating) : 5,
    images: uploaded || [],
    productId: body.productId ? String(body.productId) : undefined,
  });

  sendSuccess(
    res,
    { testimonial: { _id: testimonial._id, status: 'pending' } },
    'Thank you! Your story was submitted and will appear after approval.',
    201
  );
});

export const getAdminTestimonials = catchAsync(async (_req: Request, res: Response) => {
  const testimonials = await testimonialService.listAdmin();
  sendSuccess(res, { testimonials });
});

export const createTestimonial = catchAsync(async (req: Request, res: Response) => {
  const uploaded = (req as Request & { uploadedImages?: { url: string; publicId: string }[] })
    .uploadedImages;
  const body = req.body as Record<string, unknown>;

  const testimonial = await testimonialService.create({
    displayName: body.displayName as string | undefined,
    isAnonymous: body.isAnonymous === true || body.isAnonymous === 'true',
    quote: String(body.quote || ''),
    rating: body.rating !== undefined ? Number(body.rating) : 5,
    isActive: true,
    showOnHome: true,
    sortOrder: body.sortOrder !== undefined ? Number(body.sortOrder) : 0,
    images: uploaded || [],
    source: 'admin',
    status: 'approved',
  });

  await writeAdminAudit(req as AuthRequest, 'testimonial.create', {
    testimonialId: testimonial._id,
  });
  sendSuccess(res, { testimonial }, 'Testimonial created', 201);
});

export const approveTestimonial = catchAsync(async (req: Request, res: Response) => {
  const testimonial = await testimonialService.approve(req.params.id);
  await writeAdminAudit(req as AuthRequest, 'testimonial.approve', {
    testimonialId: req.params.id,
    linkedReviewId: (testimonial as { linkedReviewId?: string }).linkedReviewId,
  });
  const hasProductReview = Boolean(
    (testimonial as { linkedReviewId?: string; product?: unknown }).linkedReviewId ||
      (testimonial as { product?: unknown }).product,
  );
  sendSuccess(
    res,
    { testimonial },
    hasProductReview
      ? 'Approved — live on homepage and product page (rating updated)'
      : 'Story approved — now live on homepage',
  );
});

export const rejectTestimonial = catchAsync(async (req: Request, res: Response) => {
  const testimonial = await testimonialService.reject(req.params.id);
  await writeAdminAudit(req as AuthRequest, 'testimonial.reject', {
    testimonialId: req.params.id,
  });
  sendSuccess(res, { testimonial }, 'Story rejected');
});

export const updateTestimonial = catchAsync(async (req: Request, res: Response) => {
  const uploaded = (req as Request & { uploadedImages?: { url: string; publicId: string }[] })
    .uploadedImages;
  const body = req.body as Record<string, unknown>;

  let keepImages: { url: string; publicId: string }[] | undefined;
  if (typeof body.keepImages === 'string' && body.keepImages.trim()) {
    try {
      keepImages = JSON.parse(body.keepImages) as { url: string; publicId: string }[];
    } catch {
      keepImages = undefined;
    }
  }

  const patch: Parameters<typeof testimonialService.update>[1] = {};
  if (body.displayName !== undefined) patch.displayName = String(body.displayName);
  if (body.isAnonymous !== undefined) {
    patch.isAnonymous = body.isAnonymous === true || body.isAnonymous === 'true';
  }
  if (body.quote !== undefined) patch.quote = String(body.quote);
  if (body.rating !== undefined) patch.rating = Number(body.rating);
  if (body.isActive !== undefined) {
    patch.isActive = body.isActive !== 'false' && body.isActive !== false;
  }
  if (body.showOnHome !== undefined) {
    patch.showOnHome = body.showOnHome !== 'false' && body.showOnHome !== false;
  }
  if (body.sortOrder !== undefined) patch.sortOrder = Number(body.sortOrder);
  if (keepImages !== undefined || (uploaded && uploaded.length > 0)) {
    patch.images = [...(keepImages || []), ...(uploaded || [])];
  }

  const testimonial = await testimonialService.update(req.params.id, patch);
  await writeAdminAudit(req as AuthRequest, 'testimonial.update', {
    testimonialId: req.params.id,
  });
  sendSuccess(res, { testimonial }, 'Testimonial updated');
});

export const deleteTestimonial = catchAsync(async (req: Request, res: Response) => {
  await testimonialService.remove(req.params.id);
  await writeAdminAudit(req as AuthRequest, 'testimonial.delete', {
    testimonialId: req.params.id,
  });
  res.status(204).end();
});
