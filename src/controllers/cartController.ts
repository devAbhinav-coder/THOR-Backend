import { Response, NextFunction } from "express";
import mongoose from "mongoose";
import catchAsync from "../types/utils/catchAsync";
import { AuthRequest } from "../types";
import { sendSuccess } from "../types/utils/response";
import { cartService, cartAnalyticsService } from "../services/cartService";
import { cartProductService } from "../services/cart/cartProductService";
import {
  assertProductAvailableForCart,
  assertMinQuantity,
  assertQuantityWithinStock,
  validateCustomFields,
  resolveVariantForCart,
  normalizeCustomFieldAnswers,
  assertCartItemExists,
  assertNonEmptyCart,
  assertCouponAppliedToCart,
  findCouponByCode,
  normalizeCouponCode,
} from "../services/cart/cartValidationService";
import {
  getIdempotentCartResult,
  storeIdempotentCartResult,
  resolveIdempotencyKey,
} from "../services/cart/cartIdempotencyService";
import {
  recordCartMutationAttempt,
  isCartMutationThrottled,
} from "../services/cart/cartAbuseService";
import { recordFailedCouponAttempt } from "../services/coupon/couponAbuseService";
import {
  calculateCouponDiscount,
  evaluateCouponValidity,
  type CouponLike,
} from "../services/coupon/couponBusinessRules";
import { buildCouponLinesFromCartItems } from "../services/coupon/couponLineScopeService";
import { resolveCartPromotion } from "../services/promotion/promotionApplyService";
import { getUserDeliveredOrderCount } from "../services/coupon/couponUserStatsService";
import logger from "../types/utils/logger";
import { getRequestContext } from "../types/utils/requestContext";
import AppError from "../types/utils/AppError";
import {
  generateCartItemId,
  generateCustomizationHash,
} from "../services/cart/cartHash";

function userId(req: AuthRequest): string {
  return String(req.user!._id);
}

function clientIp(req: AuthRequest): string {
  return String(req.ip || req.socket?.remoteAddress || "unknown");
}

async function guardMutationAbuse(req: AuthRequest): Promise<void> {
  const uid = userId(req);
  const ip = clientIp(req);
  if (await isCartMutationThrottled(uid, ip)) {
    throw new AppError("Too many cart updates. Please try again later.", 429);
  }
  await recordCartMutationAttempt(uid, ip);
}

function logCartAction(
  action: string,
  req: AuthRequest,
  extra: Record<string, string | undefined> = {},
): void {
  const ctx = getRequestContext();
  logger.info({
    msg: "cart_action",
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
    req.headers["idempotency-key"],
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

  const cartBefore = await cartService.getCart(uid);
  const hash = generateCustomizationHash(parsedAnswers);
  const cartItemId = generateCartItemId(productVariant.sku, hash);
  const existingLine = cartBefore.items.find((i) => i.cartItemId === cartItemId);
  assertQuantityWithinStock(
    productVariant,
    quantity,
    existingLine?.quantity ?? 0,
  );

  const cartDto = await cartService.addItem(
    uid,
    product,
    productVariant.sku,
    quantity,
    parsedAnswers,
  );

  storeIdempotentCartResult(uid, idempotencyKey, cartDto);
  logCartAction("add", req, {
    productId,
    cartId: cartDto._id ? String(cartDto._id) : undefined,
  });

  sendSuccess(res, { cart: cartDto });
});

export const uploadCustomFieldImage = catchAsync(
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    const uploaded = (
      req as AuthRequest & {
        uploadedImages?: { url: string; publicId: string }[];
      }
    ).uploadedImages;
    const first = uploaded?.[0];
    if (!first) {
      return next(new AppError("Please upload an image.", 400));
    }
    sendSuccess(res, { image: first }, "Image uploaded");
  },
);

export const updateCartItem = catchAsync(
  async (req: AuthRequest, res: Response) => {
    await guardMutationAbuse(req);

    const uid = userId(req);
    const { cartItemId } = req.params;
    const { quantity } = req.body;

    const idempotencyKey = resolveIdempotencyKey(
      req.body.idempotencyKey,
      req.headers["idempotency-key"],
    );
    const replay = await getIdempotentCartResult(uid, idempotencyKey);
    if (replay) {
      sendSuccess(res, { cart: replay });
      return;
    }

    const cart = await cartService.getCart(uid);
    const item = assertCartItemExists(cart, cartItemId);

    const product = await cartProductService.findForAddToCart(String(item.product));
    assertProductAvailableForCart(product);
    const liveVariant = resolveVariantForCart(product, item.variant.sku);
    assertQuantityWithinStock(liveVariant, quantity, 0);
    assertMinQuantity(product, quantity, item.productName);

    const updatedCart = await cartService.updateItemQty(
      uid,
      cartItemId,
      quantity,
    );
    storeIdempotentCartResult(uid, idempotencyKey, updatedCart);
    cartAnalyticsService.trackQuantityUpdate(uid, cartItemId);
    logCartAction("update_qty", req, {
      cartItemId,
      productId: String(item.product),
    });

    sendSuccess(res, { cart: updatedCart });
  },
);

export const removeFromCart = catchAsync(
  async (req: AuthRequest, res: Response) => {
    const { cartItemId } = req.params;
    if (!cartItemId) {
      throw new AppError("Cart item ID is required.", 400);
    }

    const updatedCart = await cartService.removeItem(userId(req), cartItemId);
    logCartAction("remove", req, { cartItemId });
    sendSuccess(res, { cart: updatedCart });
  },
);

export const clearCart = catchAsync(async (req: AuthRequest, res: Response) => {
  await cartService.clearCart(userId(req));
  logCartAction("clear", req);
  sendSuccess(res, {}, "Cart cleared");
});

export const applyCoupon = catchAsync(
  async (req: AuthRequest, res: Response) => {
    await guardMutationAbuse(req);

    const uid = userId(req);
    const normalizedCode = normalizeCouponCode(req.body.couponCode);
    const ip = clientIp(req);

    const idempotencyKey = resolveIdempotencyKey(
      req.body.idempotencyKey,
      req.headers["idempotency-key"],
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
      throw new AppError("Invalid coupon code.", 404);
    }

    const completedOrders = await getUserDeliveredOrderCount(uid);
    const lines = await buildCouponLinesFromCartItems(
      (cart.items || []).map((item) => ({
        product: item.product,
        price: item.price,
        quantity: item.quantity,
      })),
    );
    const validity = evaluateCouponValidity(
      coupon as CouponLike,
      uid,
      cart.subtotal,
      { completedOrders, lines },
    );
    if (!validity.valid) {
      await recordFailedCouponAttempt(uid, ip, normalizedCode);
      cartAnalyticsService.trackCouponApply(false, uid, normalizedCode);
      throw new AppError(
        validity.message || "Coupon is not valid for this cart.",
        400,
      );
    }

    const eligibleBase =
      validity.eligibleAmount !== undefined ? validity.eligibleAmount : cart.subtotal;
    const previewDiscount = calculateCouponDiscount(
      coupon as CouponLike,
      eligibleBase,
      lines,
    );
    if (previewDiscount <= 0) {
      await recordFailedCouponAttempt(uid, ip, normalizedCode);
      cartAnalyticsService.trackCouponApply(false, uid, normalizedCode);
      const typed = coupon as CouponLike;
      const scoped = (typed.scopeType || "all") !== "all";
      throw new AppError(
        typed.discountType === "fixed"
          ? scoped
            ? `Eligible items must be priced above ₹${typed.discountValue} for this offer`
            : `Eligible items must total more than ₹${typed.discountValue} for this offer`
          : "This coupon does not reduce the price of items in your cart.",
        400,
      );
    }

    const updatedCart = await cartService.applyCoupon(
      uid,
      coupon._id as mongoose.Types.ObjectId,
    );

    try {
      assertCouponAppliedToCart(updatedCart, String(coupon.code));
      cartAnalyticsService.trackCouponApply(true, uid, normalizedCode);
    } catch (err) {
      cartAnalyticsService.trackCouponApply(false, uid, normalizedCode);
      throw err;
    }

    storeIdempotentCartResult(uid, idempotencyKey, updatedCart);
    logCartAction("apply_coupon", req, { couponCode: normalizedCode });

    sendSuccess(res, { cart: updatedCart });
  },
);

export const removeCoupon = catchAsync(
  async (req: AuthRequest, res: Response) => {
    const updatedCart = await cartService.removeCoupon(userId(req));
    logCartAction("remove_coupon", req);
    sendSuccess(res, { cart: updatedCart });
  },
);

/** Live auto-offer preview for checkout (cart lines or buy-now). */
export const previewCartPromotion = catchAsync(
  async (req: AuthRequest, res: Response) => {
    const { items } = req.body as {
      items: Array<{ productId: string; price: number; quantity: number }>;
    };

    const lines = await buildCouponLinesFromCartItems(
      items.map((item) => ({
        product: item.productId,
        price: Number(item.price),
        quantity: Number(item.quantity),
      })),
    );

    const result = await resolveCartPromotion(lines);

    sendSuccess(res, {
      promotion: result.promotion,
      promotionDiscount: result.discount,
      promotionHint: result.hint,
    });
  },
);

/** Live buy-now line price (sale-aware) + auto-offer preview for checkout. */
export const previewBuyNowCheckout = catchAsync(
  async (req: AuthRequest, res: Response) => {
    const body = req.body as {
      productId: string;
      variant: { sku: string; size?: string; color?: string; colorCode?: string };
      quantity: number;
    };

    const { checkoutService } = await import('../services/checkoutService');
    const preview = await checkoutService.previewBuyNowCheckout(body);

    sendSuccess(res, preview);
  },
);
