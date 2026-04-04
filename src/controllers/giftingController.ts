import { Request, Response, NextFunction } from 'express';
import catchAsync from '../utils/catchAsync';
import AppError from '../utils/AppError';
import GiftingRequest from '../models/GiftingRequest';
import Product from '../models/Product';
import Order from '../models/Order';
import User from '../models/User';
import { emailTemplates } from '../services/emailService';
import { AuthRequest, IOrderItem } from '../types';
import Category, { ICategory } from '../models/Category';
import { notifyAdmins, notifyUser } from '../services/notificationService';
import { enqueueEmail } from '../queues/emailQueue';
import { getCache, setCache } from '../services/cacheService';
import { productRepository } from '../repositories/productRepository';
import { sendPaginated, sendSuccess } from '../utils/response';
import { giftingRepository } from '../repositories/giftingRepository';
import { buildCustomOrderItems } from '../services/giftingService';
import { safeJsonParse } from '../utils/safeJson';
import { reconcileProductJson } from '../utils/productStock';

const extractObjectIdString = (value: unknown): string | null => {
  if (!value) return null;
  if (typeof value === 'string') return value;
  if (typeof value === 'object' && value !== null && '_id' in value) {
    return String((value as { _id: unknown })._id);
  }
  return String(value);
};

// ─── Public: Get giftable products ────────────────────────────────────────────
export const getGiftableProducts = catchAsync(async (req: Request, res: Response) => {
  const { giftOccasion, category, search, page = 1, limit = 24 } = req.query as Record<string, string>;

  const filter: Record<string, unknown> = { isGiftable: true, isActive: true };
  if (giftOccasion) filter.giftOccasions = { $in: [giftOccasion] };
  if (category) filter.category = category;
  if (search?.trim()) {
    const safe = search.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const tokens = safe.split(/\s+/).filter(Boolean);
    const tokenRegex = tokens.map((t) => new RegExp(t, 'i'));
    filter.$or = [
      { name: { $regex: safe, $options: 'i' } },
      { shortDescription: { $regex: safe, $options: 'i' } },
      { description: { $regex: safe, $options: 'i' } },
      { category: { $regex: safe, $options: 'i' } },
      { tags: { $in: tokenRegex } },
      { giftOccasions: { $in: tokenRegex } },
    ];
  }

  const skip = (Number(page) - 1) * Number(limit);
  const cacheKey = `cache:gifting:products:${JSON.stringify({ giftOccasion, category, search, page, limit })}`;
  const cached = await getCache<{ products: unknown[]; total: number }>(cacheKey);
  if (cached) {
    const products = cached.products.map((p) =>
      reconcileProductJson(p as Parameters<typeof reconcileProductJson>[0]),
    );
    sendSuccess(res, { products, total: cached.total, page: Number(page), limit: Number(limit) });
    return;
  }

  const [products, total] = await Promise.all([
    productRepository.findGiftable(filter, skip, Number(limit)),
    Product.countDocuments(filter),
  ]);
  const normalized = products.map((p) =>
    reconcileProductJson(p.toJSON() as Parameters<typeof reconcileProductJson>[0]),
  );
  await setCache(cacheKey, { products: normalized, total }, 120);

  sendSuccess(res, { products: normalized, total, page: Number(page), limit: Number(limit) });
});

// ─── Public: Get gift categories ─────────────────────────────────────────────
export const getGiftCategories = catchAsync(async (_req: Request, res: Response) => {
  const cats = await (Category as unknown as { find: (q: object) => Promise<ICategory[]> }).find({ isGiftCategory: true, isActive: true });
  sendSuccess(res, { categories: cats });
});

// ─── User: Submit gifting request ─────────────────────────────────────────────
export const submitGiftingRequest = catchAsync(async (req: AuthRequest, res: Response, next: NextFunction) => {
  const { name, email, phone, occasion, items, recipientMessage, customizationNote, packagingPreference, customPackagingNote, proposedPrice } = req.body;

  if (!name || !email || !occasion || !items) {
    return next(new AppError('Name, email, occasion and items are required.', 400));
  }

  const itemsParsed = safeJsonParse<unknown[]>(items, [], 'items');
  if (!itemsParsed?.length) {
    return next(new AppError('Please add at least one item to your request.', 400));
  }

  const uploadedImages = (req as Request & { uploadedImages?: { url: string; publicId: string }[] }).uploadedImages;
  const referenceImages = uploadedImages ? uploadedImages : [];

  const giftRequest = await giftingRepository.create({
    user: req.user?._id,
    name,
    email,
    phone,
    occasion,
    items: itemsParsed,
    recipientMessage,
    customizationNote,
    packagingPreference: packagingPreference || 'standard',
    customPackagingNote,
    referenceImages,
    proposedPrice: proposedPrice ? Number(proposedPrice) : undefined,
    status: 'new',
  });

  // Notify admins — in-app
  await notifyAdmins(
    'New Custom Gift Request',
    `${name} submitted a customization request for "${occasion}" (${itemsParsed.length} item${itemsParsed.length !== 1 ? 's' : ''}).`,
    `/admin/gifting`,
    'order',
  );

  // Notify admins — email
  try {
    const admins = await User.find({ role: 'admin', isActive: true }).select('email');
    const tpl = emailTemplates.adminNewGiftingRequest(
      name,
      email,
      phone,
      occasion,
      itemsParsed.length,
      proposedPrice ? Number(proposedPrice) : undefined,
      String(giftRequest._id),
    );
    await Promise.all(
      admins.map((a) =>
        enqueueEmail({ to: a.email, subject: tpl.subject, html: tpl.html }),
      ),
    );
  } catch {
    // non-fatal – request already created
  }

  sendSuccess(res, { request: giftRequest }, 'Gifting request submitted', 201);
});

// ─── Admin: Get all gifting requests ──────────────────────────────────────────
export const getGiftingRequests = catchAsync(async (req: Request, res: Response) => {
  const { status, page = 1, limit = 30 } = req.query as Record<string, string>;
  const filter: Record<string, unknown> = {};
  if (status) filter.status = status;

  const skip = (Number(page) - 1) * Number(limit);
  const [requests, total] = await Promise.all([
    giftingRepository.list(filter, skip, Number(limit)),
    giftingRepository.count(filter),
  ]);
  sendPaginated(res, { requests }, { page: Number(page), limit: Number(limit), total });
});

// ─── Shared: Get single gifting request by ID ──────────────────────────────────
export const getGiftingRequestById = catchAsync(async (req: AuthRequest, res: Response, next: NextFunction) => {
  const { id } = req.params;
  const isAdmin = req.user?.role === 'admin';

  const request = await giftingRepository.findByIdWithDetails(id);

  if (!request) return next(new AppError('Gifting request not found', 404));

  // Non-admin can only read their own request
  // After .populate(), request.user is an object {_id,...} not a raw ObjectId
  // so we must extract ._id safely
  const requestUserId = extractObjectIdString(request.user);

  if (!isAdmin && requestUserId !== req.user?._id.toString()) {
    return next(new AppError('You are not authorized to view this request.', 403));
  }

  sendSuccess(res, { request });
});

// ─── User: Get my gifting requests ─────────────────────────────────────────────
export const getMyGiftingRequests = catchAsync(async (req: AuthRequest, res: Response) => {
  const { page = 1, limit = 20 } = req.query as Record<string, string>;
  const skip = (Number(page) - 1) * Number(limit);

  const [requests, total] = await Promise.all([
    giftingRepository.listForUser(String(req.user?._id), skip, Number(limit)),
    giftingRepository.count({ user: req.user?._id }),
  ]);
  sendPaginated(res, { requests }, { page: Number(page), limit: Number(limit), total });
});

// ─── Admin: Update gifting request status ────────────────────────────────────
export const updateGiftingRequest = catchAsync(async (req: Request, res: Response, next: NextFunction) => {
  const { id } = req.params;
  const { status, adminNote, quotedPrice, deliveryTime } = req.body;

  // Find without populate first so save() doesn't depopulate and confuse things
  const request = await giftingRepository.findById(id);
  if (!request) return next(new AppError('Gifting request not found', 404));

  if (status) request.status = status;
  if (adminNote !== undefined) request.adminNote = adminNote;
  if (quotedPrice !== undefined) request.quotedPrice = Number(quotedPrice);
  if (deliveryTime !== undefined) request.deliveryTime = deliveryTime;

  await request.save();

  // Send quote notifications to user
  if (status === 'price_quoted' && request.user) {
    // Fetch fresh user data directly — don't rely on populate state after save()
    const userDoc = await User.findById(request.user).select('name email').lean();
    if (userDoc) {
      // In-app notification
      await notifyUser(
        request.user,
        'Quote Ready for Your Custom Gift 🎁',
        `Your custom gift request for "${request.occasion}" has been quoted at ₹${request.quotedPrice?.toLocaleString('en-IN')}. Review and accept to place your order.`,
        `/dashboard/gifting/${request._id}`,
        'order',
      );

      // Email notification
      try {
        await enqueueEmail({
          to: userDoc.email,
          ...emailTemplates.customGiftQuote(
            userDoc.name,
            request.occasion,
            request.quotedPrice!,
            request.deliveryTime || 'To be confirmed',
            request.adminNote,
            request._id.toString()
          )
        });
      } catch {
        // non-fatal
      }
    }
  }

  // Return the request with user populated for the admin UI
  const populated = await giftingRepository.findByIdWithDetails(String(request._id));

  sendSuccess(res, { request: populated });
});

// ─── User: Accept or Reject Quote ───────────────────────────────────────────
export const userRespondToQuote = catchAsync(async (req: AuthRequest, res: Response, next: NextFunction) => {
  const { id } = req.params;
  const { action, shippingAddress } = req.body; // action: 'accept' | 'reject'

  const request = await giftingRepository.findById(id);
  await request?.populate('items.product', 'name description images price');
  if (!request) return next(new AppError('Gifting request not found', 404));

  // Check ownership — safe for both raw ObjectId and populated object
  const requestUserId = extractObjectIdString(request.user);
  if (requestUserId !== req.user?._id.toString()) {
    return next(new AppError('You are not authorized to respond to this request.', 403));
  }

  if (action === 'reject') {
    request.status = 'rejected_by_user';
    await request.save();

    // Notify admins — in-app
    await notifyAdmins(
      'Custom Gift Quote Rejected',
      `${req.user?.name || request.name} rejected the quote for "${request.occasion}".`,
      `/admin/gifting`,
      'alert',
    );

    // Notify admins — email
    try {
      const admins = await User.find({ role: 'admin', isActive: true }).select('email');
      const tpl = emailTemplates.adminCustomGiftRejected(
        req.user?.name || request.name,
        request.occasion,
        String(request._id),
      );
      await Promise.all(
        admins.map((a) =>
          enqueueEmail({ to: a.email, subject: tpl.subject, html: tpl.html }),
        ),
      );
    } catch {
      // non-fatal
    }

    sendSuccess(res, {}, 'Request rejected and closed.');
    return;
  }

  if (action === 'accept') {
    if (request.status !== 'price_quoted') {
      return next(new AppError('Only quoted requests can be accepted.', 400));
    }

    if (!shippingAddress || !shippingAddress.name || !shippingAddress.street || !shippingAddress.city || !shippingAddress.state || !shippingAddress.pincode) {
      return next(new AppError('A valid shipping address is required to accept the quote.', 400));
    }

    // Build order items
    const orderItems: IOrderItem[] = buildCustomOrderItems(request);

    const subtotal = request.quotedPrice!;
    const total = subtotal;

    const order = await Order.create({
      user: req.user?._id,
      items: orderItems,
      shippingAddress: {
        name: shippingAddress.name,
        phone: shippingAddress.phone || req.user?.phone || '',
        label: shippingAddress.label || 'Home',
        street: shippingAddress.street,
        city: shippingAddress.city,
        state: shippingAddress.state,
        pincode: shippingAddress.pincode,
        country: shippingAddress.country || 'India',
      },
      status: 'pending',
      paymentStatus: 'pending',
      paymentMethod: 'cod',
      subtotal,
      discount: 0,
      shippingCharge: 0,
      tax: 0,
      total,
      productType: 'custom',
      customRequestId: request._id,
    });

    // Update request status + link the order back to this request
    request.status = 'approved_by_user';
    request.linkedOrderId = order._id;
    await request.save();

    // Notify user — in-app
    await notifyUser(
      req.user?._id,
      'Custom Gift Order Created 🎁',
      `Your custom gift order ${order.orderNumber} has been created. Our team will reach out to arrange payment and delivery.`,
      `/dashboard/orders/${order._id}`,
      'order',
    );

    // Email to user
    try {
      await enqueueEmail({
        to: req.user?.email || '',
        ...emailTemplates.customGiftOrderCreated(
          req.user?.name || request.name,
          request.occasion,
          order.orderNumber,
          request.quotedPrice!,
          String(order._id),
        ),
      });
    } catch {
      // non-fatal
    }

    // Notify admins — in-app
    await notifyAdmins(
      'Custom Gift Quote Accepted ✅',
      `${req.user?.name || request.name} accepted the quote for "${request.occasion}". Order ${order.orderNumber} created.`,
      `/admin/orders/${order._id}`,
      'order',
    );

    // Notify admins — email
    try {
      const admins = await User.find({ role: 'admin', isActive: true }).select('email');
      const tpl = emailTemplates.adminCustomGiftAccepted(
        req.user?.name || request.name,
        request.occasion,
        order.orderNumber,
        request.quotedPrice!,
        String(order._id),
      );
      await Promise.all(
        admins.map((a) =>
          enqueueEmail({ to: a.email, subject: tpl.subject, html: tpl.html }),
        ),
      );
    } catch {
      // non-fatal
    }

    sendSuccess(res, { orderId: order._id, orderNumber: order.orderNumber });
    return;
  }

  return next(new AppError('Invalid action. Use "accept" or "reject".', 400));
});
