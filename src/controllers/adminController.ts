import { Request, Response, NextFunction } from 'express';
import { Types } from 'mongoose';
import Order from '../models/Order';
import User from '../models/User';
import Product from '../models/Product';
import Review from '../models/Review';
import AppError from '../utils/AppError';
import catchAsync from '../utils/catchAsync';
import { emailTemplates } from '../services/emailService';
import { enqueueBroadcastChunks, enqueueEmail } from '../queues/emailQueue';
import { incrementVariantStock } from '../services/inventoryService';
import { refProductId } from '../utils/productStock';
import { sanitizeMarketingEmailHtml } from '../utils/sanitizeMarketingHtml';
import { notifyUser } from '../services/notificationService';
import { sendPaginated, sendSuccess } from '../utils/response';
import { enqueueBroadcastByUserFilter } from '../services/broadcastService';
import { getDashboardAnalyticsData } from '../services/adminAnalyticsService';
import AdminAuditLog from '../models/AdminAuditLog';
import { writeAdminAudit } from '../services/adminAuditService';

export const getDashboardAnalytics = catchAsync(async (_req: Request, res: Response) => {
  const data = await getDashboardAnalyticsData();
  sendSuccess(res, data);
});

export const getAdminAuditLogs = catchAsync(async (req: Request, res: Response, next: NextFunction) => {
  const page = Math.max(1, parseInt((req.query.page as string) || '1', 10));
  const limit = Math.min(100, Math.max(1, parseInt((req.query.limit as string) || '20', 10)));
  const skip = (page - 1) * limit;
  const filter: Record<string, unknown> = {};

  const action = String(req.query.action || '').trim();
  const ip = String(req.query.ip || '').trim();
  const userId = String(req.query.userId || '').trim();
  const from = String(req.query.from || '').trim();
  const to = String(req.query.to || '').trim();

  if (action) filter.action = action;
  if (ip) filter.ip = { $regex: ip.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' };
  if (userId) {
    if (!Types.ObjectId.isValid(userId)) {
      return next(new AppError('Invalid user id filter.', 400));
    }
    filter.$or = [{ actor: userId }, { targetUser: userId }];
  }
  if (from || to) {
    const createdAt: Record<string, Date> = {};
    if (from) {
      const d = new Date(from);
      if (Number.isNaN(d.getTime())) return next(new AppError('Invalid from date.', 400));
      createdAt.$gte = d;
    }
    if (to) {
      const d = new Date(to);
      if (Number.isNaN(d.getTime())) return next(new AppError('Invalid to date.', 400));
      createdAt.$lte = d;
    }
    filter.createdAt = createdAt;
  }

  const [logs, total] = await Promise.all([
    AdminAuditLog.find(filter)
      .sort('-createdAt')
      .skip(skip)
      .limit(limit)
      .populate('actor', 'name email role')
      .populate('targetUser', 'name email role'),
    AdminAuditLog.countDocuments(filter),
  ]);

  sendPaginated(res, { logs }, { page, limit, total });
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

export const generateOrderInvoice = catchAsync(async (req: Request, res: Response, next: NextFunction) => {
  const order = await Order.findById(req.params.id);
  if (!order) return next(new AppError('Order not found.', 404));

  const invoiceEligible = order.paymentStatus === 'paid' || order.status === 'delivered';
  if (!invoiceEligible) {
    return next(new AppError('Invoice can be generated only for paid or delivered orders.', 400));
  }

  if (!order.invoice?.isGenerated) {
    order.invoice = { isGenerated: true, generatedAt: new Date() };
    await order.save();
  }

  sendSuccess(res, { invoice: order.invoice, orderId: String(order._id) }, 'Invoice generated.');
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
    const emails = selectedRecipients.map((r) => r.email);
    const chunks = await enqueueBroadcastChunks(emails, tpl.subject, tpl.html);
    sendSuccess(
      res,
      { recipients: selectedRecipients.length, chunkJobs: chunks },
      `Queued ${selectedRecipients.length} marketing emails in ${chunks} batch(es).`,
    );
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
  const roleQuery = String(req.query.role || 'user').trim().toLowerCase();
  const filter: Record<string, unknown> =
    roleQuery === 'admin'
      ? { role: 'admin' }
      : roleQuery === 'all'
        ? {}
        : { role: 'user' };

  const [users, total] = await Promise.all([
    User.find(filter)
      .sort('-createdAt')
      .skip(skip)
      .limit(limit)
      .select('name email phone avatar role isActive createdAt'),
    User.countDocuments(filter),
  ]);

  sendPaginated(res, { users }, { page, limit, total });
});

export const toggleUserStatus = catchAsync(async (req: Request, res: Response, next: NextFunction) => {
  if (!Types.ObjectId.isValid(req.params.id)) {
    return next(new AppError('Invalid user id.', 400));
  }
  const user = await User.findById(req.params.id);
  if (!user) return next(new AppError('User not found.', 404));
  if (user.role === 'admin') {
    return next(new AppError('Admin account status cannot be toggled from this route.', 403));
  }

  user.isActive = !user.isActive;
  await user.save();
  await writeAdminAudit(req, 'user.status.toggled', { isActive: user.isActive }, String(user._id));

  sendSuccess(res, { isActive: user.isActive });
});

export const updateUserRole = catchAsync(async (req: Request, res: Response, next: NextFunction) => {
  const { role } = req.body as { role?: 'user' | 'admin' };
  if (!Types.ObjectId.isValid(req.params.id)) {
    return next(new AppError('Invalid user id.', 400));
  }
  if (!role) {
    return next(new AppError('Role is required.', 400));
  }

  const actor = (req as Request & { user?: { _id?: unknown; role?: string } }).user;
  if (!actor || actor.role !== 'admin') {
    return next(new AppError('Only admins can change roles.', 403));
  }
  if (String(actor._id) === req.params.id) {
    return next(new AppError('You cannot change your own role.', 403));
  }

  const user = await User.findById(req.params.id);
  if (!user) return next(new AppError('User not found.', 404));
  if (user.role === role) {
    return next(new AppError(`User is already ${role}.`, 400));
  }

  const previousRole = user.role;
  user.role = role;
  await user.save();
  await writeAdminAudit(
    req,
    'user.role.updated',
    { previousRole, newRole: role },
    String(user._id)
  );

  sendSuccess(res, { user: { _id: user._id, role: user.role } }, 'User role updated.');
});

export const getUserInsights = catchAsync(async (req: Request, res: Response, next: NextFunction) => {
  if (!Types.ObjectId.isValid(req.params.id)) {
    return next(new AppError('Invalid user id.', 400));
  }
  const user = await User.findById(req.params.id).select('name email phone avatar role isActive createdAt adminNote');
  if (!user) return next(new AppError('User not found.', 404));

  const orders = await Order.find({ user: user._id })
    .sort('-createdAt')
    .limit(20)
    .select('orderNumber status paymentStatus total createdAt items');

  const paidOrders = orders.filter((o) => o.paymentStatus === 'paid');
  const totalSpent = paidOrders.reduce((acc, o) => acc + Number(o.total || 0), 0);
  const orderCount = orders.length;
  const paidOrderCount = paidOrders.length;
  const avgOrderValue = paidOrderCount > 0 ? totalSpent / paidOrderCount : 0;
  const lastOrderAt = orders[0]?.createdAt || null;
  const userSegment =
    paidOrderCount >= 5 || totalSpent >= 20000
      ? 'frequent_buyer'
      : paidOrderCount >= 2
        ? 'repeat_buyer'
        : paidOrderCount >= 1
          ? 'new_buyer'
          : 'prospect';

  sendSuccess(res, {
    user,
    metrics: {
      orderCount,
      paidOrderCount,
      totalSpent,
      avgOrderValue: Math.round(avgOrderValue * 100) / 100,
      lastOrderAt,
      userSegment,
    },
    orders,
  });
});

export const updateUserNote = catchAsync(async (req: Request, res: Response, next: NextFunction) => {
  if (!Types.ObjectId.isValid(req.params.id)) {
    return next(new AppError('Invalid user id.', 400));
  }
  const note = String(req.body?.note || '').trim();
  const user = await User.findById(req.params.id);
  if (!user) return next(new AppError('User not found.', 404));
  user.adminNote = note.slice(0, 1000);
  await user.save();
  await writeAdminAudit(req, 'user.note.updated', { noteLength: user.adminNote.length }, String(user._id));
  sendSuccess(res, { user: { _id: user._id, adminNote: user.adminNote } }, 'User note updated.');
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
