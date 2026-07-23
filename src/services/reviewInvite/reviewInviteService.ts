import crypto from 'crypto';
import mongoose from 'mongoose';
import QRCode from 'qrcode';
import ReviewInvite from '../../models/ReviewInvite';
import Order from '../../models/Order';
import Product from '../../models/Product';
import Review from '../../models/Review';
import User from '../../models/User';
import AppError from '../../types/utils/AppError';
import { OFFLINE_MANUAL_PRODUCT_TAG } from '../../constants/offlineOrder';
import { REVIEW_QUERY_MAX_MS } from '../reviews/reviewConstants';
import { reviewCacheService } from '../reviews/reviewCacheService';
import { applyModerationToReview } from '../reviews/reviewModerationService';
import { emitReviewEvent } from '../reviews/reviewEventService';
import { recordReviewMetric } from '../reviews/reviewMetricsService';
import { testimonialService } from '../testimonialService';
import { emailTemplates } from '../emailService';
import { enqueueEmail } from '../../queues/emailQueue';

const INVITE_TTL_DAYS = Number(process.env.REVIEW_INVITE_TTL_DAYS || 90);
const TOKEN_BYTES = 32;

function frontendBase(): string {
  return (process.env.FRONTEND_URL || 'https://thehouseofrani.com').replace(/\/$/, '');
}

function invitePublicUrl(token: string): string {
  return `${frontendBase()}/review-invite/${encodeURIComponent(token)}`;
}

/** Safely extract Mongo ObjectId string from raw id / populated doc. */
function resolveId(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string') {
    return mongoose.Types.ObjectId.isValid(value) ? value : '';
  }
  if (value instanceof mongoose.Types.ObjectId) {
    return value.toHexString();
  }
  if (typeof value === 'object') {
    const o = value as { _id?: unknown; id?: unknown };
    if (o._id != null) return resolveId(o._id);
    if (o.id != null) return resolveId(o.id);
  }
  return '';
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function isRealCustomerEmail(email?: string | null): boolean {
  if (!email) return false;
  const e = email.toLowerCase();
  return !e.endsWith('@offline.local') && !e.endsWith('@review.local');
}

async function catalogProductIdsFromOrder(orderId: string): Promise<string[]> {
  const order = await Order.findById(orderId)
    .select('items.product')
    .lean()
    .maxTimeMS(REVIEW_QUERY_MAX_MS);
  if (!order) throw new AppError('Order not found.', 404);

  const rawIds = [
    ...new Set(
      (order.items || [])
        .map((it) => String((it as { product?: unknown }).product || ''))
        .filter((id) => mongoose.Types.ObjectId.isValid(id)),
    ),
  ];
  if (!rawIds.length) return [];

  const products = await Product.find({
    _id: { $in: rawIds },
    isActive: true,
    tags: { $nin: [OFFLINE_MANUAL_PRODUCT_TAG] },
  })
    .select('_id')
    .lean()
    .maxTimeMS(REVIEW_QUERY_MAX_MS);

  return products.map((p) => String(p._id));
}

async function assertInviteUsable(token: string) {
  const invite = await ReviewInvite.findOne({ token }).maxTimeMS(REVIEW_QUERY_MAX_MS);
  if (!invite || invite.revokedAt) {
    throw new AppError('This review link is invalid or has been revoked.', 404);
  }
  if (invite.expiresAt.getTime() < Date.now()) {
    throw new AppError('This review link has expired. Please ask us for a new one.', 410);
  }
  return invite;
}

export const reviewInviteService = {
  invitePublicUrl,

  async createQrDataUrl(url: string): Promise<string> {
    return QRCode.toDataURL(url, {
      errorCorrectionLevel: 'H',
      margin: 2,
      width: 480,
      color: { dark: '#0b1220', light: '#ffffff' },
    });
  },

  /** Create or reuse active invite for an order. */
  async createOrGetForOrder(orderId: string, adminId?: string) {
    if (!mongoose.Types.ObjectId.isValid(orderId)) {
      throw new AppError('Invalid order id.', 400);
    }

    const order = await Order.findById(orderId)
      .select('_id orderNumber user status offlineMeta')
      .populate('user', 'name email phone')
      .maxTimeMS(REVIEW_QUERY_MAX_MS);
    if (!order) throw new AppError('Order not found.', 404);

    const productIds = await catalogProductIdsFromOrder(orderId);
    if (!productIds.length) {
      throw new AppError(
        'No catalog products on this order to review (manual lines are excluded).',
        400,
      );
    }

    const now = new Date();
    let invite = await ReviewInvite.findOne({
      order: orderId,
      revokedAt: null,
      expiresAt: { $gt: now },
    }).maxTimeMS(REVIEW_QUERY_MAX_MS);

    if (!invite) {
      const token = crypto.randomBytes(TOKEN_BYTES).toString('base64url');
      const expiresAt = new Date(now.getTime() + INVITE_TTL_DAYS * 24 * 60 * 60 * 1000);
      invite = await ReviewInvite.create({
        token,
        order: orderId,
        productIds,
        reviewedProductIds: [],
        expiresAt,
        createdByAdmin: adminId || null,
      });
    } else {
      // Refresh eligible products if order items changed
      invite.productIds = productIds.map((id) => new mongoose.Types.ObjectId(id));
      await invite.save();
    }

    const url = invitePublicUrl(invite.token);
    const qrDataUrl = await this.createQrDataUrl(url);
    const user = order.user as unknown as { name?: string; email?: string; phone?: string };

    return {
      invite: {
        _id: String(invite._id),
        token: invite.token,
        url,
        qrDataUrl,
        expiresAt: invite.expiresAt,
        emailSentAt: invite.emailSentAt || null,
        productCount: invite.productIds.length,
        reviewedCount: invite.reviewedProductIds.length,
      },
      order: {
        _id: String(order._id),
        orderNumber: order.orderNumber,
        customerName: user?.name || 'Customer',
        customerEmail: isRealCustomerEmail(user?.email) ? user.email : null,
        customerPhone: user?.phone || null,
      },
    };
  },

  async getPublicInvite(token: string) {
    const invite = await assertInviteUsable(token);
    const order = await Order.findById(invite.order)
      .select('orderNumber items.product items.name items.image user')
      .populate('user', 'name')
      .lean()
      .maxTimeMS(REVIEW_QUERY_MAX_MS);
    if (!order) throw new AppError('Order not found for this invite.', 404);

    const reviewedSet = new Set(invite.reviewedProductIds.map(String));
    const products = await Product.find({
      _id: { $in: invite.productIds },
      isActive: true,
      tags: { $nin: [OFFLINE_MANUAL_PRODUCT_TAG] },
    })
      .select('name slug images')
      .lean()
      .maxTimeMS(REVIEW_QUERY_MAX_MS);

    const orderUserId = resolveId((order as { user?: unknown }).user);
    const existingReviews = orderUserId
      ? await Review.find({
          user: orderUserId,
          product: { $in: invite.productIds },
        })
          .select('product')
          .lean()
          .maxTimeMS(REVIEW_QUERY_MAX_MS)
      : [];
    const alreadyReviewedByUser = new Set(existingReviews.map((r) => String(r.product)));

    const items = products.map((p) => {
      const id = String(p._id);
      const line = (order.items || []).find(
        (it) => resolveId((it as { product?: unknown }).product) === id,
      ) as { name?: string; image?: string } | undefined;
      return {
        productId: id,
        name: line?.name || p.name,
        slug: p.slug,
        image: line?.image || p.images?.[0]?.url || null,
        alreadyReviewed: reviewedSet.has(id) || alreadyReviewedByUser.has(id),
      };
    });

    const populatedUser = (order as { user?: { name?: string } | string }).user;
    const customerName =
      typeof populatedUser === 'object' && populatedUser?.name
        ? String(populatedUser.name).trim() || 'Guest'
        : 'Guest';

    return {
      orderNumber: order.orderNumber,
      customerFirstName: customerName.split(/\s+/)[0] || 'there',
      expiresAt: invite.expiresAt,
      items,
      remainingCount: items.filter((i) => !i.alreadyReviewed).length,
    };
  },

  async submit(
    token: string,
    input: {
      productId: string;
      rating: number;
      title?: string;
      comment: string;
      displayName?: string;
      isAnonymous?: boolean;
      images?: { url: string; publicId: string }[];
    },
  ) {
    const invite = await assertInviteUsable(token);
    const productId = String(input.productId || '').trim();
    if (!mongoose.Types.ObjectId.isValid(productId)) {
      throw new AppError('Invalid product.', 400);
    }
    if (!invite.productIds.some((id) => String(id) === productId)) {
      throw new AppError('This product is not part of your purchase invite.', 403);
    }
    if (invite.reviewedProductIds.some((id) => String(id) === productId)) {
      throw new AppError('You have already reviewed this product via this link.', 409);
    }

    const comment = normalizeWhitespace(input.comment);
    if (comment.length < 10) {
      throw new AppError('Please write at least 10 characters.', 400);
    }
    const rating = Number(input.rating);
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
      throw new AppError('Rating must be between 1 and 5.', 400);
    }
    const images = input.images?.slice(0, 5) || [];
    if (images.length < 1) {
      throw new AppError('Please add at least one photo.', 400);
    }

    const order = await Order.findById(invite.order)
      .select('_id user status')
      .maxTimeMS(REVIEW_QUERY_MAX_MS);
    if (!order?.user) throw new AppError('Order customer not found.', 404);

    const userId = resolveId(order.user);
    if (!userId || !mongoose.Types.ObjectId.isValid(userId)) {
      throw new AppError('Order customer not found.', 404);
    }
    const existing = await Review.findOne({ product: productId, user: userId })
      .select('_id')
      .lean()
      .maxTimeMS(REVIEW_QUERY_MAX_MS);
    if (existing) {
      throw new AppError('You have already reviewed this product.', 409);
    }

    const anonymous =
      Boolean(input.isAnonymous) || !String(input.displayName || '').trim();
    const displayName = anonymous
      ? 'Anonymous'
      : String(input.displayName).trim().slice(0, 80);

    const title = input.title ? normalizeWhitespace(input.title) : undefined;

    const [review] = await Review.create([
      {
        product: new mongoose.Types.ObjectId(productId),
        user: new mongoose.Types.ObjectId(userId),
        order: order._id,
        rating,
        title,
        comment,
        images,
        isVerifiedPurchase: true,
        source: 'invite',
        status: 'pending_moderation',
        userSnapshot: { name: displayName },
        helpfulCount: 0,
      },
    ]);
    applyModerationToReview(review, title, comment);
    review.status = 'pending_moderation';
    await review.save();

    invite.reviewedProductIds.push(new mongoose.Types.ObjectId(productId));
    await invite.save();

    // Keep display name friendly on guest-ish accounts without overwriting real accounts
    const userDoc = await User.findById(userId).select('name email offlineLead');
    if (userDoc && !anonymous && userDoc.offlineLead) {
      userDoc.name = displayName.slice(0, 50);
      await userDoc.save().catch(() => {});
    }

    const story = await testimonialService.submitFromPublicLink({
      displayName: anonymous ? '' : displayName,
      isAnonymous: anonymous,
      quote: comment.slice(0, 1200),
      rating,
      images,
      productId,
      linkedReviewId: String(review._id),
    });

    reviewCacheService.scheduleInvalidateProduct(productId);
    recordReviewMetric('review.created', {
      productId,
      rating,
      source: 'invite',
    });
    emitReviewEvent({
      type: 'review.created',
      reviewId: String(review._id),
      productId,
      userId,
      meta: { rating, source: 'invite' },
    });

    const remaining = invite.productIds.filter(
      (id) => !invite.reviewedProductIds.some((r) => String(r) === String(id)),
    ).length;

    return {
      reviewId: String(review._id),
      testimonialId: String(story._id),
      status: 'pending_moderation',
      remainingCount: remaining,
    };
  },

  async sendInviteEmail(orderId: string, adminId?: string) {
    const payload = await this.createOrGetForOrder(orderId, adminId);
    const email = payload.order.customerEmail;
    if (!email) {
      throw new AppError(
        'No customer email on this order. Copy the link or QR instead.',
        400,
      );
    }

    const tpl = emailTemplates.reviewInvite({
      name: payload.order.customerName,
      orderNumber: payload.order.orderNumber,
      inviteUrl: payload.invite.url,
      qrDataUrl: payload.invite.qrDataUrl,
      expiresAt: payload.invite.expiresAt,
    });

    await enqueueEmail({
      to: email,
      subject: tpl.subject,
      html: tpl.html,
    });

    await ReviewInvite.findByIdAndUpdate(payload.invite._id, {
      emailSentAt: new Date(),
    });

    return {
      ...payload,
      invite: { ...payload.invite, emailSentAt: new Date() },
      emailedTo: email,
    };
  },

  async revoke(orderId: string) {
    await ReviewInvite.updateMany(
      { order: orderId, revokedAt: null },
      { $set: { revokedAt: new Date() } },
    );
  },
};
