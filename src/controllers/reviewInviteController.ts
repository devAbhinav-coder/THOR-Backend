import { Request, Response } from 'express';
import catchAsync from '../types/utils/catchAsync';
import { AuthRequest } from '../types';
import { sendSuccess } from '../types/utils/response';
import { writeAdminAudit } from '../services/adminAuditService';
import { reviewInviteService } from '../services/reviewInvite/reviewInviteService';

export const getPublicReviewInvite = catchAsync(async (req: Request, res: Response) => {
  const data = await reviewInviteService.getPublicInvite(req.params.token);
  sendSuccess(res, data);
});

export const submitReviewInvite = catchAsync(async (req: Request, res: Response) => {
  const uploaded = (
    req as Request & { uploadedImages?: { url: string; publicId: string }[] }
  ).uploadedImages;
  const body = req.body as Record<string, unknown>;

  const result = await reviewInviteService.submit(req.params.token, {
    productId: String(body.productId || ''),
    rating: Number(body.rating),
    title: body.title ? String(body.title) : undefined,
    comment: String(body.comment || ''),
    displayName: body.displayName ? String(body.displayName) : undefined,
    isAnonymous: body.isAnonymous === true || body.isAnonymous === 'true',
    images: uploaded || [],
  });

  sendSuccess(
    res,
    result,
    'Thank you! Your review and story were submitted for approval.',
    201,
  );
});

export const adminCreateReviewInvite = catchAsync(async (req: Request, res: Response) => {
  const auth = req as AuthRequest;
  const data = await reviewInviteService.createOrGetForOrder(
    req.params.id,
    auth.user?._id ? String(auth.user._id) : undefined,
  );
  await writeAdminAudit(auth, 'review_invite.create', {
    orderId: req.params.id,
    inviteId: data.invite._id,
  });
  sendSuccess(res, data, 'Review invite ready');
});

export const adminEmailReviewInvite = catchAsync(async (req: Request, res: Response) => {
  const auth = req as AuthRequest;
  const data = await reviewInviteService.sendInviteEmail(
    req.params.id,
    auth.user?._id ? String(auth.user._id) : undefined,
  );
  await writeAdminAudit(auth, 'review_invite.email', {
    orderId: req.params.id,
    emailedTo: data.emailedTo,
  });
  sendSuccess(res, data, `Invite emailed to ${data.emailedTo}`);
});
