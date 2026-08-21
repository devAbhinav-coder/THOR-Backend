import { Response, NextFunction } from "express";
import { AuthRequest } from "../types";
import catchAsync from "../types/utils/catchAsync";
import AppError from "../types/utils/AppError";
import { sendSuccess } from "../types/utils/response";
import { securityLog } from "../types/utils/securityLog";
import logger from "../types/utils/logger";
import Order from "../models/Order";
import CheckoutPaymentIntent from "../models/CheckoutPaymentIntent";
import {
  paymentVerificationService,
  PaymentVerifiedOrderDto,
} from "../services/paymentVerificationService";
import { enqueueOrderEvent } from "../queues/orderQueue";
import { OrderEventType } from "../events/orderEvents";
import { resolveClientIp } from "../utils/metaUserData";
import {
  acquirePaymentVerifyLock,
  releasePaymentVerifyLock,
  tryClaimPaymentPlacedNotification,
  normalizeIdempotencyKey,
  getIdempotentPaymentVerifyResponse,
  setIdempotentPaymentVerifyResponse,
  acquirePreparePaymentLock,
  releasePreparePaymentLock,
} from "../services/checkoutConcurrency";
import { createRazorpayOrder } from "../services/razorpay";
import {
  CHECKOUT_INTENT_VERIFY_SELECT,
  ORDER_PAYMENT_RESPONSE_SELECT,
  PAYMENT_QUERY_MAX_MS,
} from "../constants/paymentQuery";
import { toOrderPaymentDto } from "../types/utils/orderPaymentDto";

async function recordIntentVerifyAttempt(intentId: string): Promise<void> {
  await CheckoutPaymentIntent.updateOne(
    { _id: intentId },
    { $inc: { verifyAttempts: 1 }, $set: { lastVerifyAttemptAt: new Date() } },
  ).maxTimeMS(PAYMENT_QUERY_MAX_MS);
}

async function sendVerifiedOrderSideEffects(
  order: PaymentVerifiedOrderDto,
  req: AuthRequest,
  razorpayPaymentId: string,
) {
  const metaBrowser = req.body?.metaBrowser as
    | { fbp?: string; fbc?: string }
    | undefined;
  const notifyOnce = await tryClaimPaymentPlacedNotification(razorpayPaymentId);
  if (notifyOnce) {
    await enqueueOrderEvent({
      eventType: OrderEventType.ORDER_PAID,
      orderId: String(order._id),
      orderNumber: String(order.orderNumber ?? ""),
      userId: String(req.user!._id),
      userName: req.user?.name,
      userEmail: req.user?.email,
      total: Number(order.total ?? 0),
      paymentMethod: "razorpay",
      razorpayPaymentId,
      ip: resolveClientIp(req),
      userAgent: req.headers["user-agent"],
      fbpCookie: metaBrowser?.fbp || req.cookies?._fbp,
      fbcCookie: metaBrowser?.fbc || req.cookies?._fbc,
    });
  }
}

function buildVerifyIdempotencyScope(body: {
  razorpayPaymentId: string;
  orderId?: string;
  checkoutIntentId?: string;
}): string {
  return `${body.razorpayPaymentId}:${body.checkoutIntentId ?? body.orderId ?? ""}`;
}

export const verifyPayment = catchAsync(
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    const {
      razorpayOrderId,
      razorpayPaymentId,
      razorpaySignature,
      orderId,
      checkoutIntentId,
    } = req.body as {
      razorpayOrderId?: string;
      razorpayPaymentId?: string;
      razorpaySignature?: string;
      orderId?: string;
      checkoutIntentId?: string;
    };

    if (!razorpayOrderId || !razorpayPaymentId || !razorpaySignature) {
      return next(
        new AppError(
          "razorpayOrderId, razorpayPaymentId, and razorpaySignature are required.",
          400,
        ),
      );
    }

    const userId = String(req.user!._id);
    const idemKey = normalizeIdempotencyKey(
      req.headers["idempotency-key"] as string | undefined,
    );
    const idemScope = buildVerifyIdempotencyScope({
      razorpayPaymentId,
      orderId,
      checkoutIntentId,
    });

    if (idemKey) {
      const cached = await getIdempotentPaymentVerifyResponse(
        userId,
        `${idemKey}:${idemScope}`,
      );
      if (cached) {
        securityLog("payment.idempotent_replay", { userId });
        return res
          .status(cached.statusCode)
          .json(cached.body as Record<string, unknown>);
      }
    }

    const paidDuplicate = await Order.findOne({
      user: req.user!._id,
      razorpayPaymentId,
      paymentStatus: "paid",
    })
      .select(ORDER_PAYMENT_RESPONSE_SELECT)
      .lean()
      .maxTimeMS(PAYMENT_QUERY_MAX_MS);

    if (paidDuplicate) {
      const dto = toOrderPaymentDto(paidDuplicate as Record<string, unknown>);
      securityLog("payment.verify_replay", { orderId: String(dto._id) });
      const body = {
        status: "success",
        data: { order: dto },
        message: "Payment already verified",
      };
      if (idemKey)
        await setIdempotentPaymentVerifyResponse(
          userId,
          `${idemKey}:${idemScope}`,
          200,
          body,
        );
      return sendSuccess(res, { order: dto }, "Payment already verified");
    }

    let payLockKey = "";

    if (checkoutIntentId) {
      payLockKey = `intent:${checkoutIntentId}`;
      const gotPayLock = await acquirePaymentVerifyLock(payLockKey);
      if (!gotPayLock) {
        securityLog("payment.verify_lock_busy", { orderId: payLockKey });
        return next(
          new AppError(
            "Payment verification in progress. Please retry in a few seconds.",
            429,
          ),
        );
      }

      try {
        await recordIntentVerifyAttempt(checkoutIntentId);

        const intent = await CheckoutPaymentIntent.findOne({
          _id: checkoutIntentId,
          user: req.user!._id,
        })
          .select(CHECKOUT_INTENT_VERIFY_SELECT)
          .maxTimeMS(PAYMENT_QUERY_MAX_MS);
        if (!intent)
          return next(new AppError("Checkout session not found.", 404));

        const expectedTotal = intent.snapshot?.total;
        if (typeof expectedTotal !== "number") {
          return next(new AppError("Checkout session is invalid.", 400));
        }

        if (intent.consumedAt && intent.createdOrderId) {
          await paymentVerificationService.verifyRazorpayGatewayForTotal(
            razorpayOrderId,
            razorpayPaymentId,
            razorpaySignature,
            expectedTotal,
          );
          const replayOrder = await Order.findOne({
            _id: intent.createdOrderId,
            user: req.user!._id,
            razorpayPaymentId,
            paymentStatus: "paid",
          })
            .select(ORDER_PAYMENT_RESPONSE_SELECT)
            .lean()
            .maxTimeMS(PAYMENT_QUERY_MAX_MS);
          if (!replayOrder) {
            return next(
              new AppError(
                "This checkout session is closed. If you were charged, contact support with your payment ID.",
                400,
              ),
            );
          }
          const dto = toOrderPaymentDto(replayOrder as Record<string, unknown>);
          securityLog("payment.verify_replay", { orderId: String(dto._id) });
          const body = {
            status: "success",
            data: { order: dto },
            message: "Payment already verified",
          };
          if (idemKey)
            await setIdempotentPaymentVerifyResponse(
              userId,
              `${idemKey}:${idemScope}`,
              200,
              body,
            );
          return sendSuccess(res, { order: dto }, "Payment already verified");
        }

        if (intent.expiresAt < new Date()) {
          return next(
            new AppError(
              "Checkout session expired. Please return to your cart and try again.",
              400,
            ),
          );
        }
        if (intent.razorpayOrderId !== razorpayOrderId) {
          return next(
            new AppError("Payment session does not match this checkout.", 400),
          );
        }

        await paymentVerificationService.verifyRazorpayGatewayForTotal(
          razorpayOrderId,
          razorpayPaymentId,
          razorpaySignature,
          expectedTotal,
        );

        const orderDto = await paymentVerificationService.finalizePaymentIntent(
          intent,
          userId,
          razorpayOrderId,
          razorpayPaymentId,
          razorpaySignature,
        );
        if (!orderDto) {
          return next(
            new AppError(
              "Order was not recorded after payment. Please contact support with your payment ID.",
              500,
            ),
          );
        }

        try {
          await sendVerifiedOrderSideEffects(orderDto, req, razorpayPaymentId);
        } catch (sideErr: unknown) {
          logger.error({
            msg: "payment.verify_side_effects_failed",
            orderId: String(orderDto._id),
            checkoutIntentId,
            error:
              sideErr instanceof Error ?
                sideErr.message
              : "side effects failed",
          });
        }
        securityLog("payment.verify_success", {
          orderId: String(orderDto._id),
          checkoutIntentId,
        });

        const successBody = {
          status: "success" as const,
          data: { order: orderDto },
          message: "Payment verified successfully",
        };
        if (idemKey)
          await setIdempotentPaymentVerifyResponse(
            userId,
            `${idemKey}:${idemScope}`,
            200,
            successBody,
          );
        return sendSuccess(
          res,
          { order: orderDto },
          "Payment verified successfully",
        );
      } catch (err) {
        if (err instanceof AppError && err.statusCode < 500) {
          securityLog("payment.verify_failed", {
            orderId: payLockKey,
            statusCode: err.statusCode,
            message: err.message,
          });
        } else {
          logger.error({
            msg: "payment.verify_unexpected_error",
            orderId: payLockKey,
            error: err instanceof Error ? err.message : String(err),
            stack: err instanceof Error ? err.stack : undefined,
          });
        }
        throw err;
      } finally {
        if (payLockKey) await releasePaymentVerifyLock(payLockKey);
      }
    }

    if (!orderId) {
      return next(
        new AppError("Either orderId or checkoutIntentId is required.", 400),
      );
    }

    const order = await Order.findOne({ _id: orderId, user: req.user!._id })
      .select("_id paymentMethod paymentStatus razorpayOrderId total")
      .maxTimeMS(PAYMENT_QUERY_MAX_MS);
    if (!order) return next(new AppError("Order not found.", 404));
    if (order.paymentMethod !== "razorpay")
      return next(new AppError("This order does not use online payment.", 400));
    if (!order.razorpayOrderId || order.razorpayOrderId !== razorpayOrderId) {
      return next(
        new AppError("Payment session does not match this order.", 400),
      );
    }
    if (order.paymentStatus === "paid") {
      const paidRow = await Order.findById(orderId)
        .select(ORDER_PAYMENT_RESPONSE_SELECT)
        .lean()
        .maxTimeMS(PAYMENT_QUERY_MAX_MS);
      const dto =
        paidRow ? toOrderPaymentDto(paidRow as Record<string, unknown>) : null;
      if (!dto) return next(new AppError("Order not found.", 404));
      securityLog("payment.verify_replay", { orderId: String(dto._id) });
      return sendSuccess(res, { order: dto }, "Payment already verified");
    }

    payLockKey = String(order._id);
    const gotPayLock = await acquirePaymentVerifyLock(payLockKey);
    if (!gotPayLock) {
      securityLog("payment.verify_lock_busy", { orderId: payLockKey });
      return next(
        new AppError(
          "Payment verification in progress. Please retry in a few seconds.",
          429,
        ),
      );
    }

    try {
      await paymentVerificationService.verifyRazorpayGatewayForTotal(
        razorpayOrderId,
        razorpayPaymentId,
        razorpaySignature,
        order.total,
      );

      const orderDto =
        await paymentVerificationService.finalizeDirectOrderVerification(
          orderId,
          userId,
          razorpayOrderId,
          razorpayPaymentId,
          razorpaySignature,
        );
      if (!orderDto) {
        return next(
          new AppError(
            "Order was not found after payment. Please contact support with your payment ID.",
            500,
          ),
        );
      }

      try {
        await sendVerifiedOrderSideEffects(orderDto, req, razorpayPaymentId);
      } catch (sideErr: unknown) {
        logger.error({
          msg: "payment.verify_side_effects_failed",
          orderId: String(orderDto._id),
          error:
            sideErr instanceof Error ? sideErr.message : "side effects failed",
        });
      }
      securityLog("payment.verify_success", { orderId: String(orderDto._id) });

      const successBody = {
        status: "success" as const,
        data: { order: orderDto },
        message: "Payment verified successfully",
      };
      if (idemKey)
        await setIdempotentPaymentVerifyResponse(
          userId,
          `${idemKey}:${idemScope}`,
          200,
          successBody,
        );
      return sendSuccess(
        res,
        { order: orderDto },
        "Payment verified successfully",
      );
    } catch (err) {
      if (err instanceof AppError && err.statusCode < 500) {
        securityLog("payment.verify_failed", {
          orderId: payLockKey,
          statusCode: err.statusCode,
          message: err.message,
        });
      } else {
        logger.error({
          msg: "payment.verify_unexpected_error",
          orderId: payLockKey,
          error: err instanceof Error ? err.message : String(err),
          stack: err instanceof Error ? err.stack : undefined,
        });
      }
      throw err;
    } finally {
      if (payLockKey) await releasePaymentVerifyLock(payLockKey);
    }
  },
);

export const prepareOrderPayment = catchAsync(
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    const { orderId } = req.params;
    const userId = String(req.user!._id);

    const order = await Order.findOne({ _id: orderId, user: req.user!._id })
      .select(
        "_id orderNumber paymentStatus paymentMethod razorpayOrderId total status statusHistory",
      )
      .maxTimeMS(PAYMENT_QUERY_MAX_MS);

    if (!order) return next(new AppError("Order not found.", 404));
    if (order.paymentStatus === "paid")
      return next(new AppError("Order is already paid.", 400));

    const gotPrepareLock = await acquirePreparePaymentLock(String(order._id));
    if (!gotPrepareLock) {
      securityLog("payment.prepare_lock_busy", { orderId: String(order._id) });
      return next(
        new AppError(
          "Payment preparation in progress. Please retry in a few seconds.",
          429,
        ),
      );
    }

    try {
      if (order.paymentMethod !== "razorpay") {
        logger.warn(
          `prepareOrderPayment: order ${order.orderNumber} payment method changed from ${order.paymentMethod} to razorpay`,
          {
            orderId: String(order._id),
            previousMethod: order.paymentMethod,
            userId,
          },
        );
        order.statusHistory.push({
          status: order.status,
          timestamp: new Date(),
          note: `Payment method changed from ${order.paymentMethod} to razorpay`,
        });
        order.paymentMethod = "razorpay";
        await order.save();
      }

      if (!order.razorpayOrderId) {
        const razorpayOrder = await createRazorpayOrder({
          amount: order.total,
          receipt: order.orderNumber,
          notes: { orderId: String(order._id) },
        });

        const linked = await Order.findOneAndUpdate(
          {
            _id: order._id,
            user: req.user!._id,
            paymentStatus: { $ne: "paid" },
            $or: [
              { razorpayOrderId: { $exists: false } },
              { razorpayOrderId: null },
              { razorpayOrderId: "" },
            ],
          },
          {
            $set: {
              razorpayOrderId: razorpayOrder.id,
              paymentMethod: "razorpay",
            },
          },
          { new: true, select: ORDER_PAYMENT_RESPONSE_SELECT },
        ).maxTimeMS(PAYMENT_QUERY_MAX_MS);

        if (linked) {
          order.razorpayOrderId = linked.razorpayOrderId;
        } else {
          const refreshed = await Order.findOne({
            _id: order._id,
            user: req.user!._id,
          })
            .select(ORDER_PAYMENT_RESPONSE_SELECT)
            .lean()
            .maxTimeMS(PAYMENT_QUERY_MAX_MS);
          if (!refreshed?.razorpayOrderId) {
            return next(
              new AppError(
                "Could not prepare payment session. Please retry.",
                409,
              ),
            );
          }
          order.razorpayOrderId = refreshed.razorpayOrderId as string;
        }
      }

      const orderDto = await Order.findById(order._id)
        .select(ORDER_PAYMENT_RESPONSE_SELECT)
        .lean()
        .maxTimeMS(PAYMENT_QUERY_MAX_MS);

      sendSuccess(res, {
        order:
          orderDto ?
            toOrderPaymentDto(orderDto as Record<string, unknown>)
          : order.toJSON(),
        razorpayOrder: {
          id: order.razorpayOrderId,
          amount: order.total * 100,
          currency: "INR",
          keyId: process.env.RAZORPAY_KEY_ID,
        },
      });
    } finally {
      await releasePreparePaymentLock(String(order._id));
    }
  },
);
