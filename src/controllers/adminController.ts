import { Request, Response, NextFunction } from 'express';
import Order from '../models/Order';
import User from '../models/User';
import Product from '../models/Product';
import Review from '../models/Review';
import AppError from '../utils/AppError';
import catchAsync from '../utils/catchAsync';
import { emailTemplates } from '../services/emailService';
import { enqueueBroadcastEmail, enqueueEmail } from '../queues/emailQueue';
import { incrementVariantStock } from '../services/inventoryService';
import { refProductId } from '../utils/productStock';
import { sanitizeMarketingEmailHtml } from '../utils/sanitizeMarketingHtml';
import { notifyUser } from '../services/notificationService';
import { sendPaginated, sendSuccess } from '../utils/response';
import { enqueueBroadcastByUserFilter } from '../services/broadcastService';
import { getDashboardAnalyticsData } from '../services/adminAnalyticsService';

export const getDashboardAnalytics = catchAsync(async (_req: Request, res: Response) => {
  const data = await getDashboardAnalyticsData();
  sendSuccess(res, data);
});

export const getAllOrders = catchAsync(async (req: Request, res: Response) => {
  const page = parseInt((req.query.page as string) || '1', 10);
  const limit = parseInt((req.query.limit as string) || '20', 10);
  const skip = (page - 1) * limit;

  const filter: Record<string, unknown> = {};
  if (req.query.status) filter.status = req.query.status;
  if (req.query.paymentStatus) filter.paymentStatus = req.query.paymentStatus;

  const [orders, total] = await Promise.all([
    Order.find(filter)
      .sort('-createdAt')
      .skip(skip)
      .limit(limit)
      .select('orderNumber status paymentStatus total createdAt user shippingAddress.city shippingAddress.state')
      .populate('user', 'name email phone'),
    Order.countDocuments(filter),
  ]);

  sendPaginated(res, { orders }, { page, limit, total });
});

export const getOrderDetails = catchAsync(async (req: Request, res: Response, next: NextFunction) => {
  const order = await Order.findById(req.params.id)
    .populate('user', 'name email phone')
    .populate('items.product', 'name images');

  if (!order) return next(new AppError('Order not found.', 404));

  sendSuccess(res, { order });
});

export const updateOrderStatus = catchAsync(async (req: Request, res: Response, next: NextFunction) => {
  const { status, note, shippingCarrier, trackingNumber, trackingUrl } = req.body;

  const order = await Order.findById(req.params.id);
  if (!order) return next(new AppError('Order not found.', 404));

  const previousStatus = order.status;
  const sameStatus = order.status === status;

  const carrierTrimmed = typeof shippingCarrier === 'string' ? shippingCarrier.trim() : undefined;
  const trackingTrimmed = typeof trackingNumber === 'string' ? trackingNumber.trim() : undefined;
  const urlTrimmed = typeof trackingUrl === 'string' ? trackingUrl.trim() : undefined;
  const noteTrimmed = typeof note === 'string' ? note.trim() : undefined;

  const hasTrackingUpdate =
    carrierTrimmed !== undefined ||
    trackingTrimmed !== undefined ||
    urlTrimmed !== undefined;

  if (sameStatus && !noteTrimmed && !hasTrackingUpdate) {
    return next(new AppError('No changes to update.', 400));
  }

  order.status = status;
  // Avoid duplicate history entries for the same status.
  if (!sameStatus) {
    order.statusHistory.push({ status, timestamp: new Date(), note: noteTrimmed });
  } else if (noteTrimmed) {
    const last = order.statusHistory[order.statusHistory.length - 1];
    if (last && last.status === status) {
      last.note = noteTrimmed;
      last.timestamp = new Date();
    }
  }

  if (status === 'shipped') {
    if (!order.shippedAt) order.shippedAt = new Date();
    // Only overwrite when a non-empty value is provided
    if (carrierTrimmed) order.shippingCarrier = carrierTrimmed;
    if (trackingTrimmed) order.trackingNumber = trackingTrimmed;
    if (urlTrimmed) order.trackingUrl = urlTrimmed;
  }

  if (status === 'delivered') {
    order.deliveredAt = new Date();
    order.paymentStatus = 'paid';
  }

  if (status === 'cancelled' && previousStatus !== 'cancelled') {
    const shouldRestock =
      order.paymentMethod === 'cod' ||
      (order.paymentMethod === 'razorpay' && order.paymentStatus === 'paid');
    if (shouldRestock) {
      for (const item of order.items) {
        await incrementVariantStock(refProductId(item.product), item.variant.sku, item.quantity);
      }
    }
  }

  await order.save();

  const populated = await Order.findById(order._id).populate('user', 'name email');
  const user = populated?.user as unknown as { name?: string; email?: string } | undefined;
  if (populated && user?.email) {
    const tpl = emailTemplates.orderStatusUpdate(
      user.name || 'Customer',
      populated.orderNumber,
      populated.status
    );
    await enqueueEmail({
      to: user.email,
      subject: tpl.subject,
      html: tpl.html,
    });
    
    await notifyUser(
      populated.user._id,
      'Order Status Update',
      `Your order ${populated.orderNumber} is now ${populated.status}.`,
      `/dashboard/orders/${populated._id}`,
      'order'
    );
  }

  sendSuccess(res, { order });
});

export const sendCustomMarketingEmail = catchAsync(async (req: Request, res: Response, next: NextFunction) => {
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
    await Promise.all(
      selectedRecipients.map((r) =>
        enqueueBroadcastEmail(
          { to: r.email, subject: tpl.subject, html: tpl.html },
          { jobId: `marketing:${subject.trim().slice(0, 32)}:${String(r._id)}` }
        )
      )
    );
    sendSuccess(res, { recipients: selectedRecipients.length }, `Queued ${selectedRecipients.length} emails`);
    return;
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
});

export const getAllUsers = catchAsync(async (req: Request, res: Response) => {
  const page = parseInt((req.query.page as string) || '1', 10);
  const limit = parseInt((req.query.limit as string) || '20', 10);
  const skip = (page - 1) * limit;

  const [users, total] = await Promise.all([
    User.find({ role: 'user' })
      .sort('-createdAt')
      .skip(skip)
      .limit(limit)
      .select('name email phone isActive createdAt'),
    User.countDocuments({ role: 'user' }),
  ]);

  sendPaginated(res, { users }, { page, limit, total });
});

export const toggleUserStatus = catchAsync(async (req: Request, res: Response, next: NextFunction) => {
  const user = await User.findById(req.params.id);
  if (!user) return next(new AppError('User not found.', 404));

  user.isActive = !user.isActive;
  await user.save();

  sendSuccess(res, { isActive: user.isActive });
});

export const getAllReviews = catchAsync(async (req: Request, res: Response) => {
  const page = parseInt((req.query.page as string) || '1', 10);
  const limit = parseInt((req.query.limit as string) || '20', 10);
  const skip = (page - 1) * limit;

  const [reviews, total] = await Promise.all([
    Review.find()
      .sort('-createdAt')
      .skip(skip)
      .limit(limit)
      .select('rating title comment createdAt user product adminReply')
      .populate('user', 'name email')
      .populate('product', 'name slug images'),
    Review.countDocuments(),
  ]);

  sendPaginated(res, { reviews }, { page, limit, total });
});

export const deleteReview = catchAsync(async (req: Request, res: Response, next: NextFunction) => {
  const review = await Review.findByIdAndDelete(req.params.id);
  if (!review) return next(new AppError('Review not found.', 404));
  res.status(204).end();
});

export const replyToReview = catchAsync(async (req: Request, res: Response, next: NextFunction) => {
  const { text } = req.body;
  if (!text?.trim()) return next(new AppError('Reply text is required.', 400));
  const review = await Review.findByIdAndUpdate(
    req.params.id,
    { adminReply: { text: text.trim(), createdAt: new Date() } },
    { new: true }
  ).populate('user', 'name avatar');
  if (!review) return next(new AppError('Review not found.', 404));
  sendSuccess(res, { review });
});
