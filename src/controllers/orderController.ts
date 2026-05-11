import mongoose from "mongoose";
import { Response, NextFunction } from "express";
import Order from "../models/Order";
import CheckoutPaymentIntent from "../models/CheckoutPaymentIntent";
import Cart from "../models/Cart";
import Product from "../models/Product";
import Coupon from "../models/Coupon";
import User from "../models/User";
import {
  createRazorpayOrder,
  verifyPaymentAndThrow,
  assertRazorpayPaymentMatchesOrder,
} from "../services/razorpay";
import {
  decrementVariantStock,
  incrementVariantStock,
} from "../services/inventoryService";
import AppError from "../utils/AppError";
import catchAsync from "../utils/catchAsync";
import { AuthRequest } from "../types";
import { emailTemplates } from "../services/emailService";
import { enqueueEmail } from "../queues/emailQueue";
import logger from "../utils/logger";
import { securityLog } from "../utils/securityLog";
import {
  normalizeIdempotencyKey,
  acquireCheckoutLock,
  releaseCheckoutLock,
  getIdempotentCheckoutResponse,
  setIdempotentCheckoutResponse,
  acquirePaymentVerifyLock,
  releasePaymentVerifyLock,
  tryClaimPaymentPlacedNotification,
} from "../services/checkoutConcurrency";
import { refProductId } from "../utils/productStock";
import {
  notifyAdmins,
  notifyUser,
  notifyAdminsEmail,
} from "../services/notificationService";
import { sendPaginated, sendSuccess } from "../utils/response";
import { orderRepository } from "../repositories/orderRepository";
import {
  buildOrderItemsFromProducts,
  computeOrderTotals,
  getGiftMinQty,
} from "../services/orderService";
import { sendPurchaseEvent } from "../services/metaCapiService";
import type { CheckoutIntentSnapshotItem } from "../models/CheckoutPaymentIntent";

async function verifyRazorpayGatewayForTotal(
  razorpayOrderId: string,
  razorpayPaymentId: string,
  razorpaySignature: string,
  expectedOrderTotalRupees: number,
): Promise<void> {
  verifyPaymentAndThrow(
    razorpayOrderId,
    razorpayPaymentId,
    razorpaySignature,
  );
  await assertRazorpayPaymentMatchesOrder(
    razorpayOrderId,
    razorpayPaymentId,
    expectedOrderTotalRupees,
  );
}

/** Best-effort coupon usage increment inside a transaction (matches legacy + intent verify flows). */
async function applyCouponUsageIncrementIfValid(
  session: mongoose.ClientSession,
  userId: mongoose.Types.ObjectId,
  couponRef: mongoose.Types.ObjectId | undefined | null,
  subtotal: number,
  logCtx: string,
): Promise<void> {
  if (!couponRef) return;
  const coupon = await Coupon.findById(couponRef).session(session);
  if (!coupon) return;
  const validity = coupon.isValid(String(userId), subtotal);
  if (!validity.valid) {
    logger.warn(`verifyPayment: coupon invalid post-payment ${logCtx}`);
    return;
  }
  const applied = await Coupon.updateOne(
    { _id: coupon._id, usedCount: coupon.usedCount },
    {
      $inc: { usedCount: 1 },
      $push: {
        usedBy: { user: userId, usedAt: new Date() },
      },
    },
    { session },
  );
  if (applied.modifiedCount !== 1) {
    logger.warn(`verifyPayment: coupon usage race ${logCtx}`);
  }
}

function normalizeOrderItemsForCreate(
  raw: unknown[],
): Array<Record<string, unknown>> {
  return raw.map((row, idx) => {
    const it = row as Record<string, unknown> & {
      product?: Parameters<typeof refProductId>[0];
    };
    const sid = refProductId(it.product);
    if (!sid || !mongoose.Types.ObjectId.isValid(sid)) {
      throw new AppError(
        `Checkout snapshot has an invalid product reference (line ${idx + 1}). Please contact support with your payment ID.`,
        500,
      );
    }
    const pid = new mongoose.Types.ObjectId(sid);
    return { ...it, product: pid };
  });
}

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
      const { shippingAddress, paymentMethod, couponCode, notes, buyNowItem } =
        req.body;

      let checkoutItems: Array<{
        product: mongoose.Types.ObjectId | { _id: mongoose.Types.ObjectId };
        variant: {
          sku: string;
          size?: string;
          color?: string;
          colorCode?: string;
        };
        quantity: number;
        price: number;
        customFieldAnswers?: { label: string; value: string }[] | string;
      }> = [];
      let checkoutSubtotal = 0;
      let cartIdToDelete: mongoose.Types.ObjectId | null = null;
      let cartCouponDiscount = 0;
      let cartCouponId: mongoose.Types.ObjectId | undefined;
      let productMap = new Map<string, InstanceType<typeof Product>>();
      if (buyNowItem) {
        const product = await Product.findById(buyNowItem.productId);
        if (!product || !product.isActive) {
          return next(new AppError("Product is no longer available.", 400));
        }
        const minQty = getGiftMinQty(product);
        if (buyNowItem.quantity < minQty) {
          return next(
            new AppError(
              `Minimum quantity for "${product.name}" is ${minQty}.`,
              400,
            ),
          );
        }
        const variant = product.variants.find(
          (v) => v.sku === buyNowItem.variant.sku,
        );
        if (!variant || variant.stock < buyNowItem.quantity) {
          return next(
            new AppError(`Insufficient stock for "${product.name}".`, 400),
          );
        }

        const linePrice = Number(variant.price ?? product.price ?? 0);
        checkoutItems = [
          {
            product: product._id as mongoose.Types.ObjectId,
            variant: buyNowItem.variant,
            quantity: buyNowItem.quantity,
            price: linePrice,
            customFieldAnswers: buyNowItem.customFieldAnswers,
          },
        ];
        checkoutSubtotal = linePrice * buyNowItem.quantity;
        productMap = new Map([[String(product._id), product]]);
      } else {
        const cart = await orderRepository.findCartForCheckout(
          String(req.user!._id),
        );
        if (!cart || cart.items.length === 0) {
          return next(new AppError("Your cart is empty.", 400));
        }

        checkoutItems = cart.items;
        checkoutSubtotal = cart.subtotal;
        cartIdToDelete = cart._id as mongoose.Types.ObjectId;
        if (cart.coupon) {
          cartCouponDiscount = cart.discount;
          cartCouponId = cart.coupon as mongoose.Types.ObjectId;
        }

        const productIds = [
          ...new Set(cart.items.map((i) => refProductId(i.product))),
        ];
        const products = await orderRepository.findProductsByIds(productIds);
        productMap = new Map(products.map((p) => [String(p._id), p]));
      }

      for (const item of checkoutItems) {
        const product = productMap.get(refProductId(item.product));
        if (!product || !product.isActive) {
          return next(new AppError(`Product is no longer available.`, 400));
        }
        const minQty = getGiftMinQty(product);
        if (item.quantity < minQty) {
          return next(
            new AppError(
              `Minimum quantity for "${product.name}" is ${minQty}.`,
              400,
            ),
          );
        }
        const variant = product.variants.find(
          (v) => v.sku === item.variant.sku,
        );
        if (!variant || variant.stock < item.quantity) {
          return next(
            new AppError(`Insufficient stock for "${product.name}".`, 400),
          );
        }
      }

      let discount = 0;
      let couponId: mongoose.Types.ObjectId | undefined;

      if (couponCode) {
        const coupon = await Coupon.findOne({ code: couponCode.toUpperCase() });
        if (coupon) {
          const validity = (
            coupon as typeof coupon & {
              isValid: (
                userId: string,
                amount: number,
              ) => { valid: boolean; message?: string };
            }
          ).isValid(String(req.user!._id), checkoutSubtotal);
          if (validity.valid) {
            discount = (
              coupon as typeof coupon & {
                calculateDiscount: (amount: number) => number;
              }
            ).calculateDiscount(checkoutSubtotal);
            couponId = coupon._id as mongoose.Types.ObjectId;
          }
        }
      } else if (cartCouponId) {
        discount = cartCouponDiscount;
        couponId = cartCouponId;
      }

      const { shippingCharge, tax, total, codFee } = computeOrderTotals(
        checkoutSubtotal,
        discount,
        paymentMethod === "razorpay" || paymentMethod === "cod" ?
          paymentMethod
        : "cod",
      );

      let orderItems: ReturnType<typeof buildOrderItemsFromProducts>;
      try {
        orderItems = buildOrderItemsFromProducts(checkoutItems, productMap);
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
      };

      if (paymentMethod === "razorpay") {
        const intentId = new mongoose.Types.ObjectId();
        const razorpayOrder = await createRazorpayOrder({
          amount: total,
          receipt: `CI_${intentId.toHexString()}`,
          notes: { checkoutIntentId: String(intentId) },
        });

        const stockLines = checkoutItems.map((item) => ({
          productId: refProductId(item.product),
          sku: item.variant.sku,
          quantity: item.quantity,
        }));

        await CheckoutPaymentIntent.create({
          _id: intentId,
          user: req.user!._id,
          razorpayOrderId: razorpayOrder.id,
          expiresAt: new Date(Date.now() + 48 * 60 * 60 * 1000),
          snapshot: {
            shippingAddress,
            items: orderItems as CheckoutIntentSnapshotItem[],
            stockLines,
            subtotal: checkoutSubtotal,
            discount,
            shippingCharge,
            codFee,
            tax,
            total,
            coupon: couponId,
            notes,
            cartIdToDelete: cartIdToDelete ?? undefined,
          },
        });

        const razorpayBody = {
          status: "success" as const,
          data: {
            checkoutIntentId: String(intentId),
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
        sendSuccess(
          res,
          razorpayBody.data as Record<string, unknown>,
          "Payment session started",
          201,
        );
        return;
      }

      const session = await mongoose.startSession();
      let codOrder: InstanceType<typeof Order> | undefined;
      try {
        await session.withTransaction(async () => {
          const created = await Order.create([orderPayload], { session });
          codOrder = created[0] as InstanceType<typeof Order>;

          for (const item of checkoutItems) {
            const ok = await decrementVariantStock(
              refProductId(item.product),
              item.variant.sku,
              item.quantity,
              { session },
            );
            if (!ok) {
              throw new AppError(
                `Insufficient stock for a cart item. Please refresh and try again.`,
                409,
              );
            }
          }

          if (couponId) {
            const coupon = await Coupon.findById(couponId).session(session);
            if (!coupon) {
              throw new AppError("Coupon is no longer valid.", 400);
            }
            const validity = coupon.isValid(
              String(req.user!._id),
              checkoutSubtotal,
            );
            if (!validity.valid) {
              throw new AppError(
                validity.message || "Coupon is not valid.",
                400,
              );
            }
            const applied = await Coupon.updateOne(
              { _id: couponId, usedCount: coupon.usedCount },
              {
                $inc: { usedCount: 1 },
                $push: { usedBy: { user: req.user!._id, usedAt: new Date() } },
              },
              { session },
            );
            if (applied.modifiedCount !== 1) {
              throw new AppError(
                "Coupon could not be applied (please try again).",
                409,
              );
            }
          }

          if (cartIdToDelete) {
            await orderRepository.deleteCartByIdInSession(
              cartIdToDelete,
              session,
            );
          }
        });
      } finally {
        await session.endSession();
      }

      if (!codOrder) {
        return next(new AppError("Order could not be created.", 500));
      }

      const userTemplate = emailTemplates.orderPlacedUser(
        req.user?.name || "Customer",
        codOrder.orderNumber,
        codOrder.total,
      );
      await enqueueEmail({
        to: req.user?.email || "",
        subject: userTemplate.subject,
        html: userTemplate.html,
      });

      const adminTemplate = emailTemplates.adminNewOrder(
        codOrder.orderNumber,
        codOrder.total,
        req.user?.name || "Customer",
        req.user?.email || "",
      );
      await notifyAdminsEmail(adminTemplate.subject, adminTemplate.html);

      await notifyAdmins(
        "New Order Received",
        `Order ${codOrder.orderNumber} placed by ${req.user?.name || "Customer"}.`,
        `/admin/orders/${codOrder._id}`,
        "order",
      );

      // Notify user in-app + push
      notifyUser(
        String(req.user!._id),
        `Order ${codOrder.orderNumber} confirmed!`,
        `We've received your order. We'll notify you when it ships.`,
        `/dashboard/orders/${codOrder._id}`,
        "order",
      ).catch(() => {});

      // Fire Meta CAPI Purchase event
      sendPurchaseEvent(
        codOrder,
        req.ip,
        req.headers["user-agent"],
        req.cookies?._fbp,
        req.cookies?._fbc
      ).catch(() => {});

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

async function sendVerifiedOrderSideEffects(
  updated: InstanceType<typeof Order>,
  req: AuthRequest,
  razorpayPaymentId: string,
) {
  const notifyOnce =
    await tryClaimPaymentPlacedNotification(razorpayPaymentId);
  if (notifyOnce) {
    const userTemplate = emailTemplates.orderPlacedUser(
      req.user?.name || "Customer",
      updated.orderNumber,
      updated.total,
    );
    await enqueueEmail({
      to: req.user?.email || "",
      subject: userTemplate.subject,
      html: userTemplate.html,
    });

    const adminTemplate = emailTemplates.adminNewOrder(
      updated.orderNumber,
      updated.total,
      req.user?.name || "Customer",
      req.user?.email || "",
    );
    await notifyAdminsEmail(adminTemplate.subject, adminTemplate.html);

    notifyUser(
      String(req.user!._id),
      `Payment confirmed — ${updated.orderNumber}`,
      `Your payment was successful! Order ${updated.orderNumber} is now confirmed and being processed.`,
      `/dashboard/orders/${updated._id}`,
      "success",
    ).catch(() => {});

    await notifyAdmins(
      "New Order Received",
      `Order ${updated.orderNumber} verified by ${req.user?.name || "Customer"}.`,
      `/admin/orders/${updated._id}`,
      "order",
    );
  }

  sendPurchaseEvent(
    updated,
    req.ip,
    req.headers["user-agent"],
    req.cookies?._fbp,
    req.cookies?._fbc
  ).catch(() => {});
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
      razorpayOrderId: string;
      razorpayPaymentId: string;
      razorpaySignature: string;
      orderId?: string;
      checkoutIntentId?: string;
    };

    let payLockKey = "";

    const paidDuplicate = await Order.findOne({
      user: req.user!._id,
      razorpayPaymentId,
      paymentStatus: "paid",
    }).populate("items.product", "name images");

    if (paidDuplicate) {
      sendSuccess(res, { order: paidDuplicate }, "Payment already verified");
      return;
    }

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
        const intent = await CheckoutPaymentIntent.findOne({
          _id: checkoutIntentId,
          user: req.user!._id,
        });
        if (!intent) {
          return next(new AppError("Checkout session not found.", 404));
        }

        if (intent.consumedAt && intent.createdOrderId) {
          await verifyRazorpayGatewayForTotal(
            razorpayOrderId,
            razorpayPaymentId,
            razorpaySignature,
            intent.snapshot.total,
          );
          const replayOrder = await Order.findOne({
            _id: intent.createdOrderId,
            user: req.user!._id,
            razorpayPaymentId,
            paymentStatus: "paid",
          }).populate("items.product", "name images");
          if (!replayOrder) {
            return next(
              new AppError(
                "This checkout session is closed. If you were charged, contact support with your payment ID.",
                400,
              ),
            );
          }
          sendSuccess(res, { order: replayOrder }, "Payment already verified");
          return;
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

        await verifyRazorpayGatewayForTotal(
          razorpayOrderId,
          razorpayPaymentId,
          razorpaySignature,
          intent.snapshot.total,
        );

        const session = await mongoose.startSession();
        try {
          await session.withTransaction(async () => {
            const existingForRz = await Order.findOne({ razorpayOrderId }).session(
              session,
            );
            if (existingForRz) {
              if (
                String(existingForRz.user) !== String(req.user!._id) ||
                existingForRz.paymentStatus !== "paid"
              ) {
                throw new AppError(
                  "Payment could not be linked to your account.",
                  400,
                );
              }
              await CheckoutPaymentIntent.updateOne(
                { _id: intent._id },
                {
                  $set: {
                    consumedAt: new Date(),
                    createdOrderId: existingForRz._id,
                  },
                },
                { session },
              );
              return;
            }

            const claimedIntent = await CheckoutPaymentIntent.findOneAndUpdate(
              { _id: intent._id, consumedAt: null },
              { $set: { consumedAt: new Date() } },
              { session, new: true },
            );
            if (!claimedIntent) {
              const peer = await CheckoutPaymentIntent.findById(
                intent._id,
              ).session(session);
              if (!peer) throw new AppError("Checkout session not found.", 404);
              if (peer.createdOrderId) {
                return;
              }
              if (peer.consumedAt && !peer.createdOrderId) {
                throw new AppError(
                  "Checkout is in an inconsistent state. Please contact support with your payment ID.",
                  409,
                );
              }
              throw new AppError(
                "Could not finalize checkout. Please retry or contact support.",
                409,
              );
            }
            if (claimedIntent.expiresAt < new Date()) {
              throw new AppError(
                "Checkout session expired. Please return to your cart and try again.",
                400,
              );
            }

            const snap = claimedIntent.snapshot;
            const orderPayload = {
              user: req.user!._id,
              items: normalizeOrderItemsForCreate(snap.items as unknown[]),
              shippingAddress: snap.shippingAddress,
              paymentMethod: "razorpay" as const,
              subtotal: snap.subtotal,
              discount: snap.discount,
              shippingCharge: snap.shippingCharge,
              codFee: snap.codFee,
              tax: snap.tax,
              total: snap.total,
              coupon: snap.coupon,
              notes: snap.notes,
              paymentStatus: "paid" as const,
              status: "confirmed" as const,
              razorpayOrderId,
              razorpayPaymentId,
              razorpaySignature,
              invoice: { isGenerated: true, generatedAt: new Date() },
            };

            const createdArr = await Order.create([orderPayload], { session });
            const newOrder = createdArr[0] as InstanceType<typeof Order>;

            for (const line of snap.stockLines) {
              const ok = await decrementVariantStock(
                line.productId,
                line.sku,
                line.quantity,
                { session },
              );
              if (!ok) {
                logger.error(
                  `verifyPayment intent: insufficient stock rz=${razorpayOrderId} sku=${line.sku}`,
                );
                throw new AppError(
                  "Inventory changed before we could confirm your payment. Please contact support with your payment ID.",
                  409,
                );
              }
            }

            await applyCouponUsageIncrementIfValid(
              session,
              req.user!._id as mongoose.Types.ObjectId,
              snap.coupon,
              snap.subtotal,
              `intent=${String(intent._id)}`,
            );

            if (snap.cartIdToDelete) {
              await orderRepository.deleteCartByIdInSession(
                snap.cartIdToDelete,
                session,
              );
            }

            const linkIntent = await CheckoutPaymentIntent.updateOne(
              { _id: intent._id, createdOrderId: null },
              { $set: { createdOrderId: newOrder._id } },
              { session },
            );
            if (linkIntent.modifiedCount !== 1) {
              throw new AppError(
                "Could not finalize checkout. Please retry or contact support.",
                409,
              );
            }
          });
        } finally {
          await session.endSession();
        }

        const intentReload = await CheckoutPaymentIntent.findById(
          checkoutIntentId,
        ).lean();
        const finalOrderId = intentReload?.createdOrderId;
        if (!finalOrderId) {
          return next(
            new AppError(
              "Order was not recorded after payment. Please contact support with your payment ID.",
              500,
            ),
          );
        }

        const updated = await Order.findById(finalOrderId).populate(
          "items.product",
          "name images",
        );
        if (!updated) {
          return next(
            new AppError(
              "Order was not found after payment. Please contact support with your payment ID.",
              500,
            ),
          );
        }

        await sendVerifiedOrderSideEffects(
          updated,
          req,
          razorpayPaymentId,
        );
        sendSuccess(res, { order: updated }, "Payment verified successfully");
        return;
      } catch (err) {
        if (err instanceof AppError && err.statusCode < 500) {
          securityLog("payment.verify_failed", {
            orderId: payLockKey,
            statusCode: err.statusCode,
            message: err.message,
          });
        }
        throw err;
      } finally {
        if (payLockKey) {
          await releasePaymentVerifyLock(payLockKey);
        }
      }
    }

    if (!orderId) {
      return next(
        new AppError("Either orderId or checkoutIntentId is required.", 400),
      );
    }

    const order = await Order.findOne({ _id: orderId, user: req.user!._id });
    if (!order) return next(new AppError("Order not found.", 404));

    if (order.paymentMethod !== "razorpay") {
      return next(new AppError("This order does not use online payment.", 400));
    }

    if (!order.razorpayOrderId || order.razorpayOrderId !== razorpayOrderId) {
      return next(
        new AppError("Payment session does not match this order.", 400),
      );
    }

    if (order.paymentStatus === "paid") {
      sendSuccess(res, { order }, "Payment already verified");
      return;
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
      await verifyRazorpayGatewayForTotal(
        razorpayOrderId,
        razorpayPaymentId,
        razorpaySignature,
        order.total,
      );

      const session = await mongoose.startSession();

      try {
        await session.withTransaction(async () => {
          const fresh = await Order.findById(orderId).session(session);
          if (!fresh || String(fresh.user) !== String(req.user!._id)) {
            throw new AppError("Order not found.", 404);
          }
          if (fresh.paymentStatus === "paid") {
            return;
          }

          for (const item of fresh.items) {
            const ok = await decrementVariantStock(
              refProductId(item.product),
              item.variant.sku,
              item.quantity,
              { session },
            );
            if (!ok) {
              logger.error(
                `verifyPayment: insufficient stock after Razorpay success order=${orderId} sku=${item.variant.sku}`,
              );
              throw new AppError(
                "Inventory changed before we could confirm your payment. Please contact support with your payment ID.",
                409,
              );
            }
          }

          await applyCouponUsageIncrementIfValid(
            session,
            req.user!._id as mongoose.Types.ObjectId,
            fresh.coupon,
            fresh.subtotal,
            `order=${orderId}`,
          );

          fresh.paymentStatus = "paid";
          fresh.status = "confirmed";
          fresh.razorpayPaymentId = razorpayPaymentId;
          fresh.razorpaySignature = razorpaySignature;
          fresh.invoice = { isGenerated: true, generatedAt: new Date() };
          fresh.statusHistory.push({
            status: "confirmed",
            timestamp: new Date(),
            note: "Payment received (Invoice auto-generated)",
          });
          await fresh.save({ session });
        });
      } finally {
        await session.endSession();
      }

      const updated = await Order.findById(orderId).populate(
        "items.product",
        "name images",
      );

      await sendVerifiedOrderSideEffects(
        updated!,
        req,
        razorpayPaymentId,
      );

      sendSuccess(res, { order: updated }, "Payment verified successfully");
    } catch (err) {
      if (err instanceof AppError && err.statusCode < 500) {
        securityLog("payment.verify_failed", {
          orderId: payLockKey,
          statusCode: err.statusCode,
          message: err.message,
        });
      }
      throw err;
    } finally {
      if (payLockKey) {
        await releasePaymentVerifyLock(payLockKey);
      }
    }
  },
);

export const prepareOrderPayment = catchAsync(
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    const { orderId } = req.params;

    const order = await Order.findOne({ _id: orderId, user: req.user!._id });
    if (!order) return next(new AppError("Order not found.", 404));

    if (order.paymentStatus === "paid") {
      return next(new AppError("Order is already paid.", 400));
    }

    if (order.paymentMethod !== "razorpay") {
      // If user wants to pay online for a COD order (optional, but good for custom)
      order.paymentMethod = "razorpay";
    }

    if (!order.razorpayOrderId) {
      const razorpayOrder = await createRazorpayOrder({
        amount: order.total,
        receipt: order.orderNumber,
        notes: { orderId: String(order._id) },
      });
      order.razorpayOrderId = razorpayOrder.id;
      await order.save();
    }

    sendSuccess(res, {
      order: order.toJSON(),
      razorpayOrder: {
        id: order.razorpayOrderId,
        amount: order.total * 100,
        currency: "INR",
        keyId: process.env.RAZORPAY_KEY_ID,
      },
    });
  },
);

export const getMyOrders = catchAsync(
  async (req: AuthRequest, res: Response) => {
    const page = parseInt((req.query.page as string) || "1", 10);
    const limit = parseInt((req.query.limit as string) || "10", 10);
    const skip = (page - 1) * limit;
    const statusStr = req.query.status as string;

    const query: Record<string, unknown> = { user: req.user!._id };

    if (statusStr) {
      if (statusStr.includes(",")) {
        query.status = { $in: statusStr.split(",") };
      } else {
        query.status = statusStr;
      }
    }

    const [orders, total] = await Promise.all([
      orderRepository.findUserOrders(query, skip, limit),
      orderRepository.countOrders(query),
    ]);
    sendPaginated(res, { orders }, { page, limit, total });
  },
);

export const getOrderById = catchAsync(
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    const order = await Order.findOne({
      _id: req.params.id,
      user: req.user!._id,
    }).populate("items.product", "name images slug");

    if (!order) return next(new AppError("Order not found.", 404));

    sendSuccess(res, { order });
  },
);

export const cancelOrder = catchAsync(
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    const order = await Order.findOne({
      _id: req.params.id,
      user: req.user!._id,
    });
    if (!order) return next(new AppError("Order not found.", 404));

    if (!["pending", "confirmed"].includes(order.status)) {
      return next(
        new AppError("Order cannot be cancelled at this stage.", 400),
      );
    }

    const shouldRestock =
      order.paymentMethod === "cod" ||
      (order.paymentMethod === "razorpay" && order.paymentStatus === "paid") ||
      order.paymentMethod === "offline_upi" ||
      order.paymentMethod === "offline_cash";

    order.status = "cancelled";
    order.statusHistory.push({
      status: "cancelled",
      timestamp: new Date(),
      note: req.body.reason || "Cancelled by customer",
    });

    await notifyAdmins(
      "Order Cancelled",
      `Order ${order.orderNumber} was cancelled by ${req.user?.name || "the customer"}.`,
      `/admin/orders/${order._id}`,
      "alert",
    );

    if (shouldRestock) {
      for (const item of order.items) {
        await incrementVariantStock(
          refProductId(item.product),
          item.variant.sku,
          item.quantity,
        );
      }
    }

    await order.save();

    // Populate user for notifications
    const cancelPopulated = await Order.findById(order._id).populate(
      "user",
      "name email",
    );
    const cancelUser = cancelPopulated?.user as unknown as
      | { _id: string; name?: string; email?: string }
      | undefined;

    // Email to user confirming cancellation
    if (cancelUser?.email) {
      const tpl = emailTemplates.userOrderCancelled(
        cancelUser.name || "Customer",
        order.orderNumber!,
        req.body.reason,
        "customer",
      );
      enqueueEmail({
        to: cancelUser.email,
        subject: tpl.subject,
        html: tpl.html,
      }).catch(() => {});
    }

    // In-App + Push to user
    notifyUser(
      String(req.user!._id),
      `Order ${order.orderNumber} cancelled`,
      `Your cancellation has been confirmed.${order.paymentMethod === "razorpay" ? " Any paid amount will be refunded within 5-7 business days." : ""}`,
      `/dashboard/orders/${order._id}`,
      "info",
    ).catch(() => {});

    // Email + in-app to admin
    if (cancelUser) {
      const adminTpl = emailTemplates.adminOrderCancelled(
        cancelUser.name || "Customer",
        cancelUser.email || "",
        order.orderNumber!,
        String(order._id),
        req.body.reason,
        "customer",
      );
      notifyAdminsEmail(adminTpl.subject, adminTpl.html).catch(() => {});
    }

    await notifyAdmins(
      "Order Cancelled",
      `Order ${order.orderNumber} was cancelled by ${req.user?.name || "the customer"}.`,
      `/admin/orders/${order._id}`,
      "alert",
    );

    sendSuccess(res, { order });
  },
);

export const requestReturn = catchAsync(
  async (req: AuthRequest, res: Response) => {
    const { id } = req.params;
    const { reason, note, refundMethod, userBankDetails } = req.body;

    if (!reason || reason.trim() === "") {
      throw new AppError("Reason is required for returning an order", 400);
    }

    const order = await Order.findOne({
      _id: id,
      user: req.user?._id,
    }).populate("user");
    if (!order) {
      throw new AppError("Order not found", 404);
    }

    if (order.status !== "delivered") {
      throw new AppError("Only delivered orders can be returned", 400);
    }

    if (order.returnStatus && order.returnStatus !== "none") {
      throw new AppError("Return request already active or processed", 400);
    }

    // 7-day return window from delivery (requires deliveredAt — set when order is marked delivered)
    if (!order.deliveredAt) {
      throw new AppError(
        "Delivery date is not recorded for this order. Please contact support.",
        400,
      );
    }
    const daysSinceDelivery =
      (Date.now() - new Date(order.deliveredAt).getTime()) /
      (1000 * 60 * 60 * 24);
    if (daysSinceDelivery > 7) {
      throw new AppError("Return window of 7 days has expired", 400);
    }

    let finalRefundMethod:
      | "original_payment"
      | "upi"
      | "bank_transfer"
      | undefined;
    if (order.paymentMethod === "razorpay") {
      finalRefundMethod = "original_payment";
    } else if (order.paymentMethod === "cod") {
      if (!refundMethod || !["upi", "bank_transfer"].includes(refundMethod)) {
        throw new AppError(
          "Valid refund method (upi or bank_transfer) is required for COD orders",
          400,
        );
      }
      finalRefundMethod = refundMethod;
      if (finalRefundMethod === "upi" && !userBankDetails?.upiId) {
        throw new AppError("UPI ID is required for UPI refund method", 400);
      }
      if (
        finalRefundMethod === "bank_transfer" &&
        (!userBankDetails?.accountNumber ||
          !userBankDetails?.ifscCode ||
          !userBankDetails?.accountName)
      ) {
        throw new AppError(
          "Account Name, Account Number and IFSC Code are required for Bank Transfer refund",
          400,
        );
      }
    }

    order.returnStatus = "requested";
    order.returnRequest = {
      reason: reason.trim(),
      note: note?.trim(),
      refundMethod: finalRefundMethod,
      userBankDetails:
        finalRefundMethod === "original_payment" ? undefined : userBankDetails,
      requestedAt: new Date(),
    };

    await order.save();

    // Fire notifications + emails
    const populatedUser = order.user as unknown as {
      name: string;
      email: string;
    };
    const userName = populatedUser?.name || "Customer";
    const userEmail = populatedUser?.email || "";
    const refundMethodLabel = finalRefundMethod || "original_payment";

    // Email to user
    if (userEmail) {
      const tpl = emailTemplates.userReturnRequested(
        userName,
        order.orderNumber!,
        order.returnRequest!.reason,
        refundMethodLabel,
      );
      enqueueEmail({
        to: userEmail,
        subject: tpl.subject,
        html: tpl.html,
      }).catch(() => {});
    }

    // Email + notification to admin
    const adminTemplate = emailTemplates.adminNewReturnRequest(
      userName,
      userEmail,
      order.orderNumber!,
      String(order._id),
      order.returnRequest!.reason,
      refundMethodLabel,
      order.paymentMethod,
    );
    notifyAdminsEmail(adminTemplate.subject, adminTemplate.html).catch(
      () => {},
    );

    notifyAdmins(
      `Return Requested — ${order.orderNumber}`,
      `${userName} has requested a return. Reason: ${order.returnRequest!.reason}`,
      `/admin/orders/${order._id}`,
      "alert",
    ).catch(() => {});

    sendSuccess(res, { order }, "Return requested successfully");
  },
);
