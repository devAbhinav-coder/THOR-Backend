import { Request, Response, NextFunction } from 'express';
import Order from '../models/Order';
import User from '../models/User';
import Product from '../models/Product';
import Review from '../models/Review';
import AppError from '../utils/AppError';
import catchAsync from '../utils/catchAsync';
import { emailTemplates } from '../services/emailService';
import { enqueueEmail } from '../queues/emailQueue';
import { incrementVariantStock } from '../services/inventoryService';
import { refProductId } from '../utils/productStock';
import { sanitizeMarketingEmailHtml } from '../utils/sanitizeMarketingHtml';
import { notifyUser } from '../services/notificationService';

export const getDashboardAnalytics = catchAsync(async (_req: Request, res: Response) => {
  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const startOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const endOfLastMonth = new Date(now.getFullYear(), now.getMonth(), 0);
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  const [
    totalRevenue,
    monthRevenue,
    lastMonthRevenue,
    totalOrders,
    monthOrders,
    totalUsers,
    newUsersThisMonth,
    totalProducts,
    lowStockProducts,
    recentOrders,
    ordersByStatus,
    revenueByMonth,
    topProducts,
    avgOrderValue,
    ordersToday,
    pendingFulfillmentCount,
    paidOrdersCount,
    totalReviews,
    reviewsThisMonth,
    topViewedRaw,
    revenueByCategory,
  ] = await Promise.all([
    Order.aggregate([
      { $match: { paymentStatus: 'paid' } },
      { $group: { _id: null, total: { $sum: '$total' } } },
    ]),
    Order.aggregate([
      { $match: { paymentStatus: 'paid', createdAt: { $gte: startOfMonth } } },
      { $group: { _id: null, total: { $sum: '$total' } } },
    ]),
    Order.aggregate([
      { $match: { paymentStatus: 'paid', createdAt: { $gte: startOfLastMonth, $lte: endOfLastMonth } } },
      { $group: { _id: null, total: { $sum: '$total' } } },
    ]),
    Order.countDocuments(),
    Order.countDocuments({ createdAt: { $gte: startOfMonth } }),
    User.countDocuments({ role: 'user' }),
    User.countDocuments({ role: 'user', createdAt: { $gte: startOfMonth } }),
    Product.countDocuments({ isActive: true }),
    Product.aggregate([
      { $match: { isActive: true } },
      { $addFields: { computedTotal: { $sum: '$variants.stock' } } },
      { $match: { computedTotal: { $lte: 5 } } },
      { $sort: { computedTotal: 1 } },
      { $limit: 10 },
      { $project: { _id: 1, name: 1, category: 1, totalStock: '$computedTotal' } },
    ]),
    Order.find().sort('-createdAt').limit(10).populate('user', 'name email'),
    Order.aggregate([
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ]),
    Order.aggregate([
      {
        $match: {
          paymentStatus: 'paid',
          createdAt: { $gte: new Date(now.getFullYear(), now.getMonth() - 11, 1) },
        },
      },
      {
        $group: {
          _id: { year: { $year: '$createdAt' }, month: { $month: '$createdAt' } },
          revenue: { $sum: '$total' },
          orders: { $sum: 1 },
        },
      },
      { $sort: { '_id.year': 1, '_id.month': 1 } },
    ]),
    Order.aggregate([
      { $match: { paymentStatus: 'paid' } },
      { $unwind: '$items' },
      {
        $group: {
          _id: '$items.product',
          totalSold: { $sum: '$items.quantity' },
          revenue: { $sum: { $multiply: ['$items.price', '$items.quantity'] } },
          name: { $first: '$items.name' },
          image: { $first: '$items.image' },
        },
      },
      { $sort: { totalSold: -1 } },
      { $limit: 5 },
    ]),
    Order.aggregate([
      { $match: { paymentStatus: 'paid' } },
      { $group: { _id: null, avg: { $avg: '$total' } } },
    ]),
    Order.countDocuments({ createdAt: { $gte: startOfToday } }),
    Order.countDocuments({ status: { $in: ['pending', 'confirmed', 'processing'] } }),
    Order.countDocuments({ paymentStatus: 'paid' }),
    Review.countDocuments(),
    Review.countDocuments({ createdAt: { $gte: startOfMonth } }),
    Product.find({ isActive: true })
      .sort({ viewCount: -1 })
      .limit(10)
      .select('name slug images category viewCount price ratings')
      .lean(),
    Order.aggregate([
      { $match: { paymentStatus: 'paid' } },
      { $unwind: '$items' },
      {
        $lookup: {
          from: 'products',
          localField: 'items.product',
          foreignField: '_id',
          as: 'p',
        },
      },
      { $unwind: { path: '$p', preserveNullAndEmptyArrays: true } },
      {
        $group: {
          _id: '$p.category',
          revenue: { $sum: { $multiply: ['$items.price', '$items.quantity'] } },
          units: { $sum: '$items.quantity' },
        },
      },
      { $match: { _id: { $nin: [null, ''] } } },
      { $sort: { revenue: -1 } },
      { $limit: 10 },
    ]),
  ]);

  const currentMonthRevenue = monthRevenue[0]?.total || 0;
  const prevMonthRevenue = lastMonthRevenue[0]?.total || 0;
  const revenueGrowth = prevMonthRevenue > 0
    ? ((currentMonthRevenue - prevMonthRevenue) / prevMonthRevenue) * 100
    : 100;

  type LeanProduct = {
    _id: unknown;
    name: string;
    slug: string;
    images?: { url: string }[];
    category: string;
    viewCount?: number;
    price: number;
    ratings?: { average: number };
  };

  let topViewedProducts: {
    _id: unknown;
    name: string;
    slug: string;
    image: string;
    category: string;
    views: number;
    price: number;
    ratingAvg: number;
    sold: number;
    conversionPercent: number;
  }[] = [];

  const viewed = topViewedRaw as LeanProduct[];
  if (viewed.length > 0) {
    const viewIds = viewed.map((p) => p._id);
    const soldRows = await Order.aggregate([
      { $match: { paymentStatus: 'paid' } },
      { $unwind: '$items' },
      { $match: { 'items.product': { $in: viewIds } } },
      { $group: { _id: '$items.product', sold: { $sum: '$items.quantity' } } },
    ]);
    const soldMap = new Map(soldRows.map((r) => [String(r._id), r.sold as number]));
    topViewedProducts = viewed.map((p) => {
      const views = p.viewCount ?? 0;
      const sold = soldMap.get(String(p._id)) || 0;
      const conversionPercent = views > 0 ? Math.round((sold / views) * 10000) / 100 : 0;
      return {
        _id: p._id,
        name: p.name,
        slug: p.slug,
        image: p.images?.[0]?.url || '',
        category: p.category,
        views,
        price: p.price,
        ratingAvg: p.ratings?.average ?? 0,
        sold,
        conversionPercent,
      };
    });
  }

  res.status(200).json({
    status: 'success',
    data: {
      overview: {
        totalRevenue: totalRevenue[0]?.total || 0,
        monthRevenue: currentMonthRevenue,
        revenueGrowth: Math.round(revenueGrowth * 10) / 10,
        totalOrders,
        monthOrders,
        totalUsers,
        newUsersThisMonth,
        totalProducts,
        avgOrderValue: Math.round((avgOrderValue[0]?.avg || 0) * 100) / 100,
        ordersToday,
        pendingFulfillmentCount,
        paidOrdersCount,
        totalReviews,
        reviewsThisMonth,
      },
      lowStockProducts,
      recentOrders,
      ordersByStatus,
      revenueByMonth,
      topProducts,
      topViewedProducts,
      revenueByCategory,
    },
  });
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
      .populate('user', 'name email phone'),
    Order.countDocuments(filter),
  ]);

  res.status(200).json({
    status: 'success',
    pagination: { currentPage: page, totalPages: Math.ceil(total / limit), total },
    data: { orders },
  });
});

export const getOrderDetails = catchAsync(async (req: Request, res: Response, next: NextFunction) => {
  const order = await Order.findById(req.params.id)
    .populate('user', 'name email phone')
    .populate('items.product', 'name images');

  if (!order) return next(new AppError('Order not found.', 404));

  res.status(200).json({ status: 'success', data: { order } });
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

  res.status(200).json({ status: 'success', data: { order } });
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

  let recipients: Array<{ email: string }> = [];
  if (audience === 'selected') {
    if (!userIds || userIds.length === 0) {
      return next(new AppError('Select at least one user.', 400));
    }
    recipients = await User.find({ _id: { $in: userIds }, isActive: true }).select('email');
  } else if (audience === 'admins') {
    recipients = await User.find({ role: 'admin', isActive: true }).select('email');
  } else if (audience === 'users') {
    recipients = await User.find({ role: 'user', isActive: true }).select('email');
  } else {
    recipients = await User.find({ isActive: true }).select('email');
  }

  const safeCtaText = ctaText?.trim();
  const safeCtaLink = ctaLink?.trim();
  const tpl = emailTemplates.custom(
    subject.trim(),
    sanitizeMarketingEmailHtml(messageHtml.trim()),
    safeCtaText,
    safeCtaLink
  );
  await Promise.all(
    recipients.map((r) =>
      enqueueEmail({
        to: r.email,
        subject: tpl.subject,
        html: tpl.html,
      })
    )
  );

  res.status(200).json({
    status: 'success',
    message: `Queued ${recipients.length} emails`,
    data: { recipients: recipients.length },
  });
});

export const getAllUsers = catchAsync(async (req: Request, res: Response) => {
  const page = parseInt((req.query.page as string) || '1', 10);
  const limit = parseInt((req.query.limit as string) || '20', 10);
  const skip = (page - 1) * limit;

  const [users, total] = await Promise.all([
    User.find({ role: 'user' }).sort('-createdAt').skip(skip).limit(limit),
    User.countDocuments({ role: 'user' }),
  ]);

  res.status(200).json({
    status: 'success',
    pagination: { currentPage: page, totalPages: Math.ceil(total / limit), total },
    data: { users },
  });
});

export const toggleUserStatus = catchAsync(async (req: Request, res: Response, next: NextFunction) => {
  const user = await User.findById(req.params.id);
  if (!user) return next(new AppError('User not found.', 404));

  user.isActive = !user.isActive;
  await user.save();

  res.status(200).json({
    status: 'success',
    data: { isActive: user.isActive },
  });
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
      .populate('user', 'name email')
      .populate('product', 'name slug images'),
    Review.countDocuments(),
  ]);

  res.status(200).json({
    status: 'success',
    pagination: { currentPage: page, totalPages: Math.ceil(total / limit), total },
    data: { reviews },
  });
});

export const deleteReview = catchAsync(async (req: Request, res: Response, next: NextFunction) => {
  const review = await Review.findByIdAndDelete(req.params.id);
  if (!review) return next(new AppError('Review not found.', 404));
  res.status(204).json({ status: 'success', data: null });
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
  res.status(200).json({ status: 'success', data: { review } });
});
