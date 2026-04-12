import { Request, Response, NextFunction } from 'express';
import { AuthRequest } from '../types';
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
import { notifyUser, notifyAdmins, notifyAdminsEmail } from '../services/notificationService';
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
    if (!order.invoice?.isGenerated) {
      order.invoice = { isGenerated: true, generatedAt: new Date() };
    }
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
    // Smart email with tracking info for 'shipped'
    const trackingOpts = status === 'shipped' ? {
      carrier: order.shippingCarrier,
      awb: order.trackingNumber,
      trackingUrl: order.trackingUrl,
    } : undefined;

    const tpl = emailTemplates.orderStatusUpdate(
      user.name || 'Customer',
      populated.orderNumber,
      populated.status,
      trackingOpts
    );
    await enqueueEmail({
      to: user.email,
      subject: tpl.subject,
      html: tpl.html,
    });

    await notifyUser(
      populated.user._id,
      status === 'shipped' ? `📦 Order ${populated.orderNumber} is on its way!` :
      status === 'delivered' ? `✅ Order ${populated.orderNumber} delivered!` :
      status === 'cancelled' ? `❌ Order ${populated.orderNumber} cancelled` :
      `Order ${populated.orderNumber} status update`,
      status === 'shipped'
        ? `Your order is on the way${order.shippingCarrier ? ` via ${order.shippingCarrier}` : ''}${order.trackingNumber ? `, AWB: ${order.trackingNumber}` : ''}.`
        : status === 'delivered'
          ? 'Your order has been delivered. We hope you love it!'
          : status === 'cancelled'
            ? 'Your order has been cancelled. Contact support if this was unexpected.'
            : `Your order is now ${status}.`,
      `/dashboard/orders/${populated._id}`,
      status === 'delivered' ? 'success' : status === 'cancelled' ? 'error' : 'order'
    );
  }

  // Admin email only for critical status changes (cancelled)
  if (status === 'cancelled') {
    if (user) {
      const adminTpl = emailTemplates.adminOrderCancelled(
        user.name || 'Customer',
        user.email || '',
        populated?.orderNumber!,
        String(order._id),
        noteTrimmed,
        'admin'
      );
      notifyAdminsEmail(adminTpl.subject, adminTpl.html).catch(() => {});
    }
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

/** Accurate active / inactive counts for the whole directory (not just current page). */
export const getUserDirectoryStats = catchAsync(async (_req: Request, res: Response) => {
  const [
    totalUsers,
    activeUsers,
    inactiveUsers,
    totalAdmins,
    activeAdmins,
    inactiveAdmins,
  ] = await Promise.all([
    User.countDocuments({ role: 'user' }),
    User.countDocuments({ role: 'user', isActive: true }),
    User.countDocuments({ role: 'user', isActive: false }),
    User.countDocuments({ role: 'admin' }),
    User.countDocuments({ role: 'admin', isActive: true }),
    User.countDocuments({ role: 'admin', isActive: false }),
  ]);

  sendSuccess(res, {
    users: { total: totalUsers, active: activeUsers, inactive: inactiveUsers },
    admins: { total: totalAdmins, active: activeAdmins, inactive: inactiveAdmins },
  });
});

export const toggleUserStatus = catchAsync(async (req: AuthRequest, res: Response, next: NextFunction) => {
  if (!Types.ObjectId.isValid(req.params.id)) {
    return next(new AppError('Invalid user id.', 400));
  }
  const actor = req.user;
  if (!actor) return next(new AppError('Not authenticated.', 401));
  if (String(actor._id) === req.params.id) {
    return next(new AppError('You cannot change your own account status here.', 403));
  }

  const user = await User.findById(req.params.id);
  if (!user) return next(new AppError('User not found.', 404));

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

export const processRefund = catchAsync(async (req: Request, res: Response, next: NextFunction) => {
  const { refundMethod, amount, notes } = req.body;
  const order = await Order.findById(req.params.id);
  
  if (!order) return next(new AppError('Order not found.', 404));
  if (order.status === 'refunded') return next(new AppError('Order is already refunded.', 400));

  const amt = typeof amount === 'number' ? amount : Number(amount);
  if (!Number.isFinite(amt) || amt <= 0) {
    return next(new AppError('Valid refund amount is required.', 400));
  }
  if (amt > order.total) {
    return next(new AppError('Refund amount cannot exceed order total.', 400));
  }

  let methodToUse = refundMethod || 'cash';
  let gatewayRefundId: string | undefined = undefined;

  // Need Razorpay Import dynamically here to avoid circular dep if not at top level
  // Or we can assume it works since we appended to razorpay.ts
  const { refundRazorpayPayment } = await import('../services/razorpay');

  if (order.paymentMethod === 'razorpay') {
    if (!order.razorpayPaymentId) {
      return next(new AppError('Razorpay payment ID missing on order.', 400));
    }
    methodToUse = 'razorpay_auto';
    try {
      const refundResult = await refundRazorpayPayment(
        order.razorpayPaymentId,
        amt,
        notes ? { reason: notes.slice(0, 40) } : undefined
      );
      gatewayRefundId = (refundResult as { id?: string }).id;
    } catch (err: unknown) {
      if (err instanceof AppError) return next(err);
      const message = err instanceof Error ? err.message : 'Razorpay automated refund failed.';
      return next(new AppError(message, 500));
    }
  } else if (!refundMethod) {
    return next(new AppError('Refund method is required for COD orders.', 400));
  }

  const previousStatus = order.status;

  order.refundData = {
    amount: amt,
    method: methodToUse,
    gatewayRefundId,
    notes,
    processedAt: new Date(),
  };

  order.status = 'refunded';
  order.paymentStatus = 'refunded';
  if (order.returnStatus && order.returnStatus !== 'none') {
    order.returnStatus = 'returned';
    if (order.returnRequest) {
      order.returnRequest.resolvedAt = new Date();
      if (notes) order.returnRequest.adminNote = notes;
    }
  }

  order.statusHistory.push({ status: 'refunded', timestamp: new Date(), note: notes || methodToUse });

  if (previousStatus !== 'cancelled') {
    for (const item of order.items) {
      await incrementVariantStock(refProductId(item.product), item.variant.sku, item.quantity);
    }
  }

  await order.save();

  await writeAdminAudit(req, 'order.refunded', { orderId: order._id, amount: amt, method: methodToUse }, req.params.id);

  const populated = await Order.findById(order._id).populate('user', 'name email');
  const user = populated?.user as unknown as { name?: string; email?: string } | undefined;

  // Collect bank/UPI details from the return request for smart notification
  const bankDetails = (order as any).returnRequest?.userBankDetails;
  const refundDetails = {
    upiId: bankDetails?.upiId,
    accountName: bankDetails?.accountName,
    accountNumber: bankDetails?.accountNumber,
    bankName: bankDetails?.bankName,
  };

  if (populated && user?.email) {
    // In-App notification to user with smart message
    const smartMessage = methodToUse === 'razorpay_auto'
      ? `₹${amt.toFixed(2)} refund initiated to your original payment method. (5-7 business days)`
      : methodToUse === 'upi_manual'
        ? `₹${amt.toFixed(2)} will be sent to your UPI ID: ${bankDetails?.upiId || 'your UPI'}. (1-2 days)`
        : methodToUse === 'bank_transfer'
          ? `₹${amt.toFixed(2)} will be transferred to your bank account ending ${(bankDetails?.accountNumber || '').slice(-4) || '—'}. (2-3 days)`
          : `₹${amt.toFixed(2)} refund has been initiated via ${methodToUse.replace(/_/g, ' ')}.`;

    notifyUser(
      String((populated.user as any)._id),
      `💸 Refund of ₹${amt.toFixed(2)} processed`,
      smartMessage,
      `/dashboard/orders/${populated._id}`,
      'success',
    ).catch(() => {});

    // Smart email to user with details
    const tpl = emailTemplates.userRefundProcessed(
      user.name || 'Customer',
      populated.orderNumber!,
      amt,
      methodToUse,
      refundDetails,
    );
    enqueueEmail({ to: user.email, subject: tpl.subject, html: tpl.html }).catch(() => {});

    // Admin audit email
    const adminTpl = emailTemplates.adminRefundProcessed(
      user.name || 'Customer',
      user.email,
      populated.orderNumber!,
      String(order._id),
      amt,
      methodToUse,
    );
    notifyAdminsEmail(adminTpl.subject, adminTpl.html).catch(() => {});

    // Admin in-app
    notifyAdmins(
      `Refund processed — ${populated.orderNumber}`,
      `₹${amt.toFixed(2)} refunded to ${user.name || 'customer'} via ${methodToUse.replace(/_/g, ' ')}.`,
      `/admin/orders/${populated._id}`,
      'order'
    ).catch(() => {});
  }

  sendSuccess(res, { order }, 'Order refunded successfully.');
});

// ─── Return Management ─────────────────────────────────────────────────────

export const getReturns = catchAsync(async (req: Request, res: Response) => {
  const page  = Math.max(1, parseInt((req.query.page  as string) || '1', 10));
  const limit = Math.min(50, Math.max(1, parseInt((req.query.limit as string) || '20', 10)));
  const status = req.query.status as string | undefined;
  const filter: Record<string, unknown> = {
    returnStatus: { $in: status ? [status] : ['requested', 'approved', 'rejected', 'returned'] },
  };
  const [total, orders] = await Promise.all([
    Order.countDocuments(filter),
    Order.find(filter)
      .sort({ 'returnRequest.requestedAt': -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .populate('user', 'name email phone')
      .select('orderNumber total status returnStatus returnRequest refundData paymentMethod createdAt deliveredAt items'),
  ]);
  sendPaginated(res, { orders }, { total, page, limit });
});

const RETURN_STATUS_FILTER = ['requested', 'approved', 'rejected', 'returned'] as const;

/** Aggregated return insights — reasons, top SKUs, top customers (real DB data). */
export const getReturnsInsights = catchAsync(async (_req: Request, res: Response) => {
  const returnMatch = { returnStatus: { $in: [...RETURN_STATUS_FILTER] } };

  const [statusBreakdown, refundedAgg, reasons, topProducts, topCustomersRaw] = await Promise.all([
    Order.aggregate<{ _id: string; count: number }>([
      { $match: returnMatch },
      { $group: { _id: '$returnStatus', count: { $sum: 1 } } },
    ]),
    Order.aggregate<{ total: number; count: number }>([
      { $match: { paymentStatus: 'refunded', 'refundData.amount': { $exists: true } } },
      { $group: { _id: null, total: { $sum: '$refundData.amount' }, count: { $sum: 1 } } },
    ]),
    Order.aggregate<{ _id: string; count: number }>([
      { $match: returnMatch },
      { $match: { 'returnRequest.reason': { $exists: true, $nin: ['', null] } } },
      { $group: { _id: '$returnRequest.reason', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 25 },
    ]),
    Order.aggregate<{ _id: Types.ObjectId; name: string; sku?: string; returnCount: number }>([
      { $match: returnMatch },
      { $unwind: '$items' },
      {
        $group: {
          _id: '$items.product',
          name: { $first: '$items.name' },
          sku: { $first: '$items.variant.sku' },
          returnCount: { $sum: 1 },
        },
      },
      { $sort: { returnCount: -1 } },
      { $limit: 20 },
    ]),
    Order.aggregate([
      { $match: returnMatch },
      { $group: { _id: '$user', returnCount: { $sum: 1 } } },
      { $sort: { returnCount: -1 } },
      { $limit: 20 },
      {
        $lookup: {
          from: 'users',
          localField: '_id',
          foreignField: '_id',
          as: 'userDoc',
        },
      },
      { $unwind: { path: '$userDoc', preserveNullAndEmptyArrays: true } },
      {
        $project: {
          _id: 0,
          userId: '$_id',
          returnCount: 1,
          name: '$userDoc.name',
          email: '$userDoc.email',
        },
      },
    ]),
  ]);

  const statusMap = Object.fromEntries(statusBreakdown.map((s) => [s._id, s.count])) as Record<string, number>;
  const totalReturnOrders = statusBreakdown.reduce((acc, s) => acc + s.count, 0);
  const ref = refundedAgg[0];

  sendSuccess(res, {
    summary: {
      totalReturnOrders,
      requested: statusMap.requested ?? 0,
      approved: statusMap.approved ?? 0,
      rejected: statusMap.rejected ?? 0,
      returned: statusMap.returned ?? 0,
      totalRefundedAmount: ref?.total ?? 0,
      refundedOrdersCount: ref?.count ?? 0,
    },
    reasons,
    topProducts: topProducts.map((p) => ({
      productId: String(p._id),
      name: p.name || 'Product',
      sku: p.sku || '',
      returnCount: p.returnCount,
    })),
    topCustomers: topCustomersRaw.map((c: { userId?: unknown; name?: string; email?: string; returnCount: number }) => ({
      userId: String(c.userId ?? ''),
      name: c.name || '—',
      email: c.email || '',
      returnCount: c.returnCount,
    })),
  });
});

export const resolveReturn = catchAsync(async (req: Request, res: Response) => {
  const { id } = req.params;
  const { action, adminNote } = req.body as { action: 'approve' | 'reject'; adminNote?: string };

  if (!['approve', 'reject'].includes(action)) {
    throw new AppError('Action must be approve or reject', 400);
  }

  const order = await Order.findById(id).populate('user', 'name email');
  if (!order) throw new AppError('Order not found', 404);
  if (order.returnStatus !== 'requested') {
    throw new AppError('Only orders with requested return status can be resolved', 400);
  }

  const newStatus = action === 'approve' ? 'approved' : 'rejected';
  order.returnStatus = newStatus;
  if (order.returnRequest) {
    order.returnRequest.resolvedAt = new Date();
    order.returnRequest.adminNote = adminNote?.trim();
  }
  if (action === 'approve') {
    order.statusHistory.push({ status: 'return_approved', timestamp: new Date(), note: adminNote } as any);
  }

  await order.save();
  await writeAdminAudit(req, `order.return_${newStatus}` as any, { orderId: order._id, adminNote }, id);

  // Notify user — email + in-app + push
  const user = order.user as unknown as { _id: string; name?: string; email?: string };
  if (user?.email) {
    const tpl = emailTemplates.userReturnStatusUpdated(
      user.name || 'Customer',
      order.orderNumber!,
      newStatus as 'approved' | 'rejected',
      adminNote,
    );
    enqueueEmail({ to: user.email, subject: tpl.subject, html: tpl.html }).catch(() => {});

    notifyUser(
      String(user._id),
      `Return ${newStatus} — ${order.orderNumber}`,
      action === 'approve'
        ? 'Your return has been approved. Refund will be processed shortly.'
        : `Your return was not approved.${adminNote ? ` Note: ${adminNote}` : ''}`,
      `/dashboard/orders/${order._id}`,
      action === 'approve' ? 'success' : 'error',
    ).catch(() => {});
  }

  // Admin confirmation — in-app + push
  notifyAdmins(
    `Return ${newStatus} — ${order.orderNumber}`,
    `You have ${newStatus} the return request from ${user?.name || 'a customer'}.`,
    `/admin/orders/${order._id}`,
    'order'
  ).catch(() => {});

  // Admin email confirmation
  const adminTpl = emailTemplates.adminReturnResolved(
    user?.name || 'Customer',
    order.orderNumber!,
    String(order._id),
    newStatus as 'approved' | 'rejected',
    adminNote,
  );
  notifyAdminsEmail(adminTpl.subject, adminTpl.html).catch(() => {});

  sendSuccess(res, { order }, `Return ${newStatus} successfully.`);
});

