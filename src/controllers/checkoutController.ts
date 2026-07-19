import { Response, NextFunction } from "express";
import { AuthRequest } from "../types";
import catchAsync from "../types/utils/catchAsync";
import AppError from "../types/utils/AppError";
import { sendSuccess } from "../types/utils/response";
import { securityLog } from "../types/utils/securityLog";
import {
  normalizeIdempotencyKey,
  acquireCheckoutLock,
  releaseCheckoutLock,
  getIdempotentCheckoutResponse,
  setIdempotentCheckoutResponse,
} from "../services/checkoutConcurrency";
import { computeOrderTotals } from "../services/orderService";
import { checkoutService } from "../services/checkoutService";
import { enqueueOrderEvent } from "../queues/orderQueue";
import { OrderEventType } from "../events/orderEvents";
import { sanitizeMarketingAttribution } from "../utils/marketingAttribution";

export const createOrder = catchAsync(
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    const userId = String(req.user!._id);
    const idemKey = normalizeIdempotencyKey(
      req.headers["idempotency-key"] as string | undefined,
    );

    if (idemKey) {
      const cached = await getIdempotentCheckoutResponse(userId, idemKey);
      if (cached) {
        securityLog("checkout.idempotent_replay", { userId });
        return res
          .status(cached.statusCode)
          .json(cached.body as Record<string, unknown>);
      }
    }

    const locked = await acquireCheckoutLock(userId);
    if (!locked) {
      securityLog("checkout.concurrent_blocked", { userId });
      return next(
        new AppError(
          "Checkout already in progress. Please wait a moment.",
          429,
        ),
      );
    }

    try {
      const {
        shippingAddress,
        paymentMethod,
        couponCode,
        notes,
        buyNowItem,
        marketingAttribution: rawAttribution,
        metaBrowser,
      } = req.body;

      const marketingAttribution = sanitizeMarketingAttribution(rawAttribution);

      let checkoutItems,
        checkoutSubtotal,
        cartIdToDelete,
        cartCouponId,
        cartCouponDiscount,
        productMap;

      if (buyNowItem) {
        ({
          checkoutItems,
          checkoutSubtotal,
          productMap,
          cartIdToDelete,
          cartCouponId,
          cartCouponDiscount,
        } = await checkoutService.processBuyNowItem(buyNowItem));
      } else {
        ({
          checkoutItems,
          checkoutSubtotal,
          productMap,
          cartIdToDelete,
          cartCouponId,
          cartCouponDiscount,
        } = await checkoutService.processCartItems(userId));
      }

      const { discount, couponId } = await checkoutService.evaluateCoupon(
        userId,
        checkoutSubtotal,
        couponCode,
        cartCouponId,
        cartCouponDiscount,
      );

      const { shippingCharge, tax, total, codFee } = computeOrderTotals(
        checkoutSubtotal,
        discount,
        paymentMethod === "razorpay" || paymentMethod === "cod" ?
          paymentMethod
        : "cod",
      );

      let orderItems;
      try {
        orderItems = await checkoutService.validateAndBuildItems(
          checkoutItems,
          productMap,
        );
      } catch (e) {
        return next(e);
      }

      const orderPayload = {
        user: req.user!._id,
        items: orderItems,
        shippingAddress,
        paymentMethod,
        subtotal: checkoutSubtotal,
        discount,
        shippingCharge,
        codFee,
        tax,
        total,
        coupon: couponId,
        notes,
        ...(marketingAttribution ? { marketingAttribution } : {}),
      };

      if (paymentMethod === "razorpay") {
        const intentData = {
          total,
          checkoutItems,
          orderItems,
          shippingAddress,
          checkoutSubtotal,
          discount,
          shippingCharge,
          codFee,
          tax,
          couponId,
          notes,
          cartIdToDelete,
          marketingAttribution,
        };

        const { intentId, razorpayOrder } =
          await checkoutService.createRazorpayIntent(userId, intentData);

        const razorpayBody = {
          status: "success" as const,
          data: {
            checkoutIntentId: intentId,
            razorpayOrder: {
              id: razorpayOrder.id,
              amount: razorpayOrder.amount,
              currency: razorpayOrder.currency,
              keyId: process.env.RAZORPAY_KEY_ID,
            },
          },
        };

        if (idemKey) {
          await setIdempotentCheckoutResponse(
            userId,
            idemKey,
            201,
            razorpayBody,
          );
        }
        return sendSuccess(
          res,
          razorpayBody.data as Record<string, unknown>,
          "Payment session started",
          201,
        );
      }

      const codOrder = await checkoutService.createCodOrder(
        orderPayload,
        checkoutItems,
        cartIdToDelete,
        couponId,
      );

      if (!codOrder) {
        return next(new AppError("Order could not be created.", 500));
      }

      // Push into event queue to offload notifications
      await enqueueOrderEvent({
        eventType: OrderEventType.ORDER_CREATED,
        orderId: String(codOrder._id),
        orderNumber: codOrder.orderNumber,
        userId,
        userName: req.user?.name,
        userEmail: req.user?.email,
        total: codOrder.total,
        paymentMethod: codOrder.paymentMethod,
        ip: req.ip,
        userAgent: req.headers["user-agent"],
        fbpCookie: metaBrowser?.fbp || req.cookies?._fbp,
        fbcCookie: metaBrowser?.fbc || req.cookies?._fbc,
      });

      const codBody = {
        status: "success" as const,
        data: { order: codOrder.toJSON() },
      };
      if (idemKey) {
        await setIdempotentCheckoutResponse(userId, idemKey, 201, codBody);
      }

      sendSuccess(
        res,
        codBody.data as Record<string, unknown>,
        "Order created",
        201,
      );
    } finally {
      await releaseCheckoutLock(userId);
    }
  },
);
