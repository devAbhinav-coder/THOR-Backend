import { Response, NextFunction } from 'express';
import mongoose from 'mongoose';
import catchAsync from '../utils/catchAsync';
import { AuthRequest } from '../types';
import { sendSuccess } from '../utils/response';
import {
  cartService,
  cartAnalyticsService,
} from '../services/cartService';
import {
  cartProductService,
} from '../services/cart/cartProductService';
import {
  assertProductAvailableForCart,
  assertMinQuantity,
  validateCustomFields,
  resolveVariantForCart,
  normalizeCustomFieldAnswers,
  assertCartItemExists,
  assertNonEmptyCart,
  assertCouponAppliedToCart,
  findCouponByCode,
  normalizeCouponCode,
} from '../services/cart/cartValidationService';
import {
  getIdempotentCartResult,
  storeIdempotentCartResult,
  resolveIdempotencyKey,
} from '../services/cart/cartIdempotencyService';
import {
  recordCartMutationAttempt,
  isCartMutationThrottled,
} from '../services/cart/cartAbuseService';
import { recordFailedCouponAttempt } from '../services/coupon/couponAbuseService';
import logger from '../utils/logger';
import { getRequestContext } from '../utils/requestContext';
import AppError from '../utils/AppError';

function userId(req: AuthRequest): string {
  return String(req.user!._id);
}

function clientIp(req: AuthRequest): string {
  return String(req.ip || req.socket?.remoteAddress || 'unknown');
}

async function guardMutationAbuse(req: AuthRequest): Promise<void> {
  const uid = userId(req);
  const ip = clientIp(req);
  if (await isCartMutationThrottled(uid, ip)) {
    throw new AppError('Too many cart updates. Please try again later.', 429);
  }
  await recordCartMutationAttempt(uid, ip);
}

function logCartAction(
  action: string,
  req: AuthRequest,
  extra: Record<string, string | undefined> = {}
): void {
  const ctx = getRequestContext();
  logger.info({
    msg: 'cart_action',
    action,
    userId: userId(req),
    requestId: ctx?.requestId,
    traceId: ctx?.traceId,
    ...extra,
  });
}

export const getCart = catchAsync(async (req: AuthRequest, res: Response) => {
  const cartDto = await cartService.getCart(userId(req));
  sendSuccess(res, { cart: cartDto });
});

export const addToCart = catchAsync(async (req: AuthRequest, res: Response) => {
  await guardMutationAbuse(req);

  const uid = userId(req);
  const idempotencyKey = resolveIdempotencyKey(
    req.body.idempotencyKey,
    req.headers['idempotency-key']
  );

  const replay = await getIdempotentCartResult(uid, idempotencyKey);
  if (replay) {
    sendSuccess(res, { cart: replay });
    return;
  }

  const { productId, variant, quantity, customFieldAnswers } = req.body;
  const product = await cartProductService.findForAddToCart(productId);
  assertProductAvailableForCart(product);

  const parsedAnswers = normalizeCustomFieldAnswers(customFieldAnswers);
  validateCustomFields(product, parsedAnswers);
  assertMinQuantity(product, quantity);

  const productVariant = resolveVariantForCart(product, variant.sku);

  const cartDto = await cartService.addItem(
    uid,
    product,
    productVariant.sku,
    quantity,
    parsedAnswers
  );

  storeIdempotentCartResult(uid, idempotencyKey, cartDto);
  logCartAction('add', req, { productId, cartId: cartDto._id ? String(cartDto._id) : undefined });

  sendSuccess(res, { cart: cartDto });
});

export const uploadCustomFieldImage = catchAsync(
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    const uploaded = (req as AuthRequest & { uploadedImages?: { url: string; publicId: string }[] })
      .uploadedImages;
    const first = uploaded?.[0];
    if (!first) {
      return next(new AppError('Please upload an image.', 400));
    }
    sendSuccess(res, { image: first }, 'Image uploaded');
  }
);

export const updateCartItem = catchAsync(async (req: AuthRequest, res: Response) => {
  await guardMutationAbuse(req);

  const uid = userId(req);
  const { cartItemId } = req.params;
  const { quantity } = req.body;

  const idempotencyKey = resolveIdempotencyKey(
    req.body.idempotencyKey,
    req.headers['idempotency-key']
  );
  const replay = await getIdempotentCartResult(uid, idempotencyKey);
  if (replay) {
    sendSuccess(res, { cart: replay });
    return;
  }

  const cart = await cartService.getCart(uid);
  const item = assertCartItemExists(cart, cartItemId);

  const product = await cartProductService.findMinQtyFields(String(item.product));
  assertMinQuantity(product, quantity, item.productName);

  const updatedCart = await cartService.updateItemQty(uid, cartItemId, quantity);
  storeIdempotentCartResult(uid, idempotencyKey, updatedCart);
  cartAnalyticsService.trackQuantityUpdate(uid, cartItemId);
  logCartAction('update_qty', req, { cartItemId, productId: String(item.product) });

  sendSuccess(res, { cart: updatedCart });
});

export const removeFromCart = catchAsync(async (req: AuthRequest, res: Response) => {
  const { cartItemId } = req.params;
  if (!cartItemId) {
    throw new AppError('Cart item ID is required.', 400);
  }

  const updatedCart = await cartService.removeItem(userId(req), cartItemId);
  logCartAction('remove', req, { cartItemId });
  sendSuccess(res, { cart: updatedCart });
});

export const clearCart = catchAsync(async (req: AuthRequest, res: Response) => {
  await cartService.clearCart(userId(req));
  logCartAction('clear', req);
  sendSuccess(res, {}, 'Cart cleared');
});

export const applyCoupon = catchAsync(async (req: AuthRequest, res: Response) => {
  await guardMutationAbuse(req);

  const uid = userId(req);
  const normalizedCode = normalizeCouponCode(req.body.couponCode);
  const ip = clientIp(req);

  const idempotencyKey = resolveIdempotencyKey(
    req.body.idempotencyKey,
    req.headers['idempotency-key']
  );
  const replay = await getIdempotentCartResult(uid, idempotencyKey);
  if (replay) {
    sendSuccess(res, { cart: replay });
    return;
  }

  const cart = await cartService.getCart(uid);
  assertNonEmptyCart(cart);

  const coupon = await findCouponByCode(normalizedCode);
  if (!coupon) {
    await recordFailedCouponAttempt(uid, ip, normalizedCode);
    cartAnalyticsService.trackCouponApply(false, uid, normalizedCode);
    throw new AppError('Invalid coupon code.', 404);
  }

  const updatedCart = await cartService.applyCoupon(
    uid,
    coupon._id as mongoose.Types.ObjectId
  );

  try {
    assertCouponAppliedToCart(updatedCart, String(coupon.code));
    cartAnalyticsService.trackCouponApply(true, uid, normalizedCode);
  } catch (err) {
    cartAnalyticsService.trackCouponApply(false, uid, normalizedCode);
    throw err;
  }

  storeIdempotentCartResult(uid, idempotencyKey, updatedCart);
  logCartAction('apply_coupon', req, { couponCode: normalizedCode });

  sendSuccess(res, { cart: updatedCart });
});

export const removeCoupon = catchAsync(async (req: AuthRequest, res: Response) => {
  const updatedCart = await cartService.removeCoupon(userId(req));
  logCartAction('remove_coupon', req);
  sendSuccess(res, { cart: updatedCart });
});
