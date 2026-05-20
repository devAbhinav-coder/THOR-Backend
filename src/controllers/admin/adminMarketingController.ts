import { Request, Response, NextFunction } from 'express';
import User from '../../models/User';
import AppError from '../../utils/AppError';
import catchAsync from '../../utils/catchAsync';
import { emailTemplates } from '../../services/emailService';
import { enqueueBroadcastChunks } from '../../queues/emailQueue';
import { sendSuccess } from '../../utils/response';
import { sanitizeMarketingEmailHtml } from '../../utils/sanitizeMarketingHtml';
import { enqueueBroadcastByUserFilter } from '../../services/broadcastService';

export const sendCustomMarketingEmail = catchAsync(
  async (req: Request, res: Response, next: NextFunction) => {
    const { subject, messageHtml, audience, userIds, ctaText, ctaLink } = req.body as {
      subject?: string;
      messageHtml?: string;
      audience?: 'all' | 'users' | 'admins' | 'selected';
      userIds?: string[];
      ctaText?: string;
      ctaLink?: string;
    };

    if (!subject?.trim() || !messageHtml?.trim()) {
      return next(new AppError('Subject and message are required.', 400));
    }

    const safeCtaText = ctaText?.trim();
    const safeCtaLink = ctaLink?.trim();
    const tpl = emailTemplates.custom(
      subject.trim(),
      sanitizeMarketingEmailHtml(messageHtml.trim()),
      safeCtaText,
      safeCtaLink
    );

    if (audience === 'selected') {
      if (!userIds || userIds.length === 0) {
        return next(new AppError('Select at least one user.', 400));
      }
      const selectedRecipients = await User.find({ _id: { $in: userIds }, isActive: true }).select('_id email');
      const emails = selectedRecipients.map((r) => r.email);
      const chunks = await enqueueBroadcastChunks(emails, tpl.subject, tpl.html);
      return sendSuccess(
        res,
        { recipients: selectedRecipients.length, chunkJobs: chunks },
        `Queued ${selectedRecipients.length} marketing emails in ${chunks} batch(es).`
      );
    }

    const filter =
      audience === 'admins'
        ? { role: 'admin', isActive: true }
        : audience === 'users'
        ? { role: 'user', isActive: true }
        : { isActive: true };

    const totalRecipients = await enqueueBroadcastByUserFilter(
      filter,
      () => ({ subject: tpl.subject, html: tpl.html, jobIdPrefix: `marketing:${subject.trim().slice(0, 32)}` }),
      400
    );

    sendSuccess(res, { recipients: totalRecipients }, `Queued ${totalRecipients} emails`);
  }
);
