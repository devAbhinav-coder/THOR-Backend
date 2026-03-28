import mongoose from 'mongoose';
import { Response, NextFunction } from 'express';
import Order from '../models/Order';
import Cart from '../models/Cart';
import Product from '../models/Product';
import Coupon from '../models/Coupon';
import User from '../models/User';
import {
  createRazorpayOrder,
  verifyPaymentAndThrow,
  assertRazorpayPaymentMatchesOrder,
} from '../services/razorpay';
import { decrementVariantStock, incrementVariantStock } from '../services/inventoryService';
import AppError from '../utils/AppError';
import catchAsync from '../utils/catchAsync';
import { AuthRequest } from '../types';
import { emailTemplates } from '../services/emailService';
import { enqueueEmail } from '../queues/emailQueue';
import logger from '../utils/logger';
import { securityLog } from '../utils/securityLog';
import {
  normalizeIdempotencyKey,
  acquireCheckoutLock,
  releaseCheckoutLock,
  getIdempotentCheckoutResponse,
  setIdempotentCheckoutResponse,
  acquirePaymentVerifyLock,
  releasePaymentVerifyLock,
  tryClaimPaymentPlacedNotification,
} from '../services/checkoutConcurrency';

const SHIPPING_THRESHOLD = 1000;
const SHIPPING_CHARGE = 100;
const TAX_RATE = 0;

function buildOrderItemsFromProducts(
  cartItems: { product: mongoose.Types.ObjectId; variant: { sku: string }; quantity: number; price: number }[],
  productMap: Map<string, InstanceType<typeof Product>>
) {
  return cartItems.map((item) => {
    const product = productMap.get(String(item.product));
    if (!product || !product.images?.[0]) {
      throw new AppError('Product data missing for order line.', 400);
    }
    return {
      product: item.product,
      name: product.name,
      image: product.images[0].url,
      variant: item.variant,
      quantity: item.quantity,
      price: item.price,
    };
  });
}

export const createOrder = catchAsync(async (req: AuthRequest, res: Response, next: NextFunction) => {
  const userId = String(req.user!._id);
  const idemKey = normalizeIdempotencyKey(req.headers['idempotency-key'] as string | undefined);

  if (idemKey) {
    const cached = await getIdempotentCheckoutResponse(userId, idemKey);
    if (cached) {
      securityLog('checkout.idempotent_replay', { userId });
      return res.status(cached.statusCode).json(cached.body as Record<string, unknown>);
    }
  }

  const locked = await acquireCheckoutLock(userId);
  if (!locked) {
    securityLog('checkout.concurrent_blocked', { userId });
    return next(new AppError('Checkout already in progress. Please wait a moment.', 429));
  }

  try {
  const { shippingAddress, paymentMethod, couponCode, notes } = req.body;

  const cart = await Cart.findOne({ user: req.user!._id }).populate('items.product');
  if (!cart || cart.items.length === 0) {
    return next(new AppError('Your cart is empty.', 400));
  }

  const productIds = [...new Set(cart.items.map((i) => String(i.product)))];
  const products = await Product.find({ _id: { $in: productIds } });
  const productMap = new Map(products.map((p) => [String(p._id), p]));

  for (const item of cart.items) {
    const product = productMap.get(String(item.product));
    if (!product || !product.isActive) {
      return next(new AppError(`Product is no longer available.`, 400));
    }
    const variant = product.variants.find((v) => v.sku === item.variant.sku);
    if (!variant || variant.stock < item.quantity) {
      return next(new AppError(`Insufficient stock for "${product.name}".`, 400));
    }
  }

  let discount = 0;
  let couponId: mongoose.Types.ObjectId | undefined;

  if (couponCode) {
    const coupon = await Coupon.findOne({ code: couponCode.toUpperCase() });
    if (coupon) {
      const validity = (
        coupon as typeof coupon & {
          isValid: (userId: string, amount: number) => { valid: boolean; message?: string };
        }
      ).isValid(String(req.user!._id), cart.subtotal);
      if (validity.valid) {
        discount = (
          coupon as typeof coupon & { calculateDiscount: (amount: number) => number }
        ).calculateDiscount(cart.subtotal);
        couponId = coupon._id as mongoose.Types.ObjectId;
      }
    }
  } else if (cart.coupon) {
    discount = cart.discount;
    couponId = cart.coupon as mongoose.Types.ObjectId;
  }

  const subtotalAfterDiscount = cart.subtotal - discount;
  const shippingCharge = subtotalAfterDiscount >= SHIPPING_THRESHOLD ? 0 : SHIPPING_CHARGE;
  const tax = Math.round(subtotalAfterDiscount * TAX_RATE * 100) / 100;
  const total = subtotalAfterDiscount + shippingCharge + tax;

  let orderItems: ReturnType<typeof buildOrderItemsFromProducts>;
  try {
    orderItems = buildOrderItemsFromProducts(cart.items, productMap);
  } catch (e) {
    return next(e);
  }

  const orderPayload = {
    user: req.user!._id,
    items: orderItems,
    shippingAddress,
    paymentMethod,
    subtotal: cart.subtotal,
    discount,
    shippingCharge,
    tax,
    total,
    coupon: couponId,
    notes,
  };

  if (paymentMethod === 'razorpay') {
    const order = await Order.create(orderPayload);

    const razorpayOrder = await createRazorpayOrder({
      amount: total,
      receipt: order.orderNumber,
      notes: { orderId: String(order._id) },
    });

    order.razorpayOrderId = razorpayOrder.id;
    await order.save();

    await Cart.findByIdAndDelete(cart._id);

    const razorpayBody = {
      status: 'success' as const,
      data: {
        order: order.toJSON(),
        razorpayOrder: {
          id: razorpayOrder.id,
          amount: razorpayOrder.amount,
          currency: razorpayOrder.currency,
          keyId: process.env.RAZORPAY_KEY_ID,
        },
      },
    };
    if (idemKey) {
      await setIdempotentCheckoutResponse(userId, idemKey, 201, razorpayBody);
    }
    return res.status(201).json(razorpayBody);
  }

  const session = await mongoose.startSession();
  let codOrder: InstanceType<typeof Order> | undefined;
  try {
    await session.withTransaction(async () => {
      const created = await Order.create([orderPayload], { session });
      codOrder = created[0] as InstanceType<typeof Order>;

      for (const item of cart.items) {
        const ok = await decrementVariantStock(item.product, item.variant.sku, item.quantity, { session });
        if (!ok) {
          throw new AppError(`Insufficient stock for a cart item. Please refresh and try again.`, 409);
        }
      }

      if (couponId) {
        const coupon = await Coupon.findById(couponId).session(session);
        if (!coupon) {
          throw new AppError('Coupon is no longer valid.', 400);
        }
        const validity = coupon.isValid(String(req.user!._id), cart.subtotal);
        if (!validity.valid) {
          throw new AppError(validity.message || 'Coupon is not valid.', 400);
        }
        const applied = await Coupon.updateOne(
          { _id: couponId, usedCount: coupon.usedCount },
          {
            $inc: { usedCount: 1 },
            $push: { usedBy: { user: req.user!._id, usedAt: new Date() } },
          },
          { session }
        );
        if (applied.modifiedCount !== 1) {
          throw new AppError('Coupon could not be applied (please try again).', 409);
        }
      }

      await Cart.deleteOne({ _id: cart._id }, { session });
    });
  } finally {
    await session.endSession();
  }

  if (!codOrder) {
    return next(new AppError('Order could not be created.', 500));
  }

  const userTemplate = emailTemplates.orderPlacedUser(
    req.user?.name || 'Customer',
    codOrder.orderNumber,
    codOrder.total
  );
  await enqueueEmail({
    to: req.user?.email || '',
    subject: userTemplate.subject,
    html: userTemplate.html,
  });

  const admins = await User.find({ role: 'admin', isActive: true }).select('email');
  const adminTemplate = emailTemplates.adminNewOrder(
    codOrder.orderNumber,
    codOrder.total,
    req.user?.name || 'Customer',
    req.user?.email || ''
  );
  await Promise.all(
    admins.map((a) =>
      enqueueEmail({
        to: a.email,
        subject: adminTemplate.subject,
        html: adminTemplate.html,
      })
    )
  );

  const codBody = { status: 'success' as const, data: { order: codOrder.toJSON() } };
  if (idemKey) {
    await setIdempotentCheckoutResponse(userId, idemKey, 201, codBody);
  }
  res.status(201).json(codBody);
  } finally {
    await releaseCheckoutLock(userId);
  }
});

export const verifyPayment = catchAsync(async (req: AuthRequest, res: Response, next: NextFunction) => {
  const { razorpayOrderId, razorpayPaymentId, razorpaySignature, orderId } = req.body;

  const order = await Order.findOne({ _id: orderId, user: req.user!._id });
  if (!order) return next(new AppError('Order not found.', 404));

  if (order.paymentMethod !== 'razorpay') {
    return next(new AppError('This order does not use online payment.', 400));
  }

  if (!order.razorpayOrderId || order.razorpayOrderId !== razorpayOrderId) {
    return next(new AppError('Payment session does not match this order.', 400));
  }

  if (order.paymentStatus === 'paid') {
    return res.status(200).json({
      status: 'success',
      message: 'Payment already verified',
      data: { order },
    });
  }

  const payLockOrderId = String(order._id);
  const gotPayLock = await acquirePaymentVerifyLock(payLockOrderId);
  if (!gotPayLock) {
    securityLog('payment.verify_lock_busy', { orderId: payLockOrderId });
    return next(
      new AppError('Payment verification in progress. Please retry in a few seconds.', 429)
    );
  }

  try {
    verifyPaymentAndThrow(razorpayOrderId, razorpayPaymentId, razorpaySignature);

    await assertRazorpayPaymentMatchesOrder(razorpayOrderId, razorpayPaymentId, order.total);

    const session = await mongoose.startSession();

    try {
    await session.withTransaction(async () => {
      const fresh = await Order.findById(orderId).session(session);
      if (!fresh || String(fresh.user) !== String(req.user!._id)) {
        throw new AppError('Order not found.', 404);
      }
      if (fresh.paymentStatus === 'paid') {
        return;
      }

      for (const item of fresh.items) {
        const ok = await decrementVariantStock(item.product, item.variant.sku, item.quantity, { session });
        if (!ok) {
          logger.error(
            `verifyPayment: insufficient stock after Razorpay success order=${orderId} sku=${item.variant.sku}`
          );
          throw new AppError(
            'Inventory changed before we could confirm your payment. Please contact support with your payment ID.',
            409
          );
        }
      }

      if (fresh.coupon) {
        const coupon = await Coupon.findById(fresh.coupon).session(session);
        if (coupon) {
          const validity = coupon.isValid(String(req.user!._id), fresh.subtotal);
          if (!validity.valid) {
            logger.warn(`verifyPayment: coupon invalid post-payment order=${orderId}`);
          } else {
            const applied = await Coupon.updateOne(
              { _id: coupon._id, usedCount: coupon.usedCount },
              {
                $inc: { usedCount: 1 },
                $push: { usedBy: { user: req.user!._id, usedAt: new Date() } },
              },
              { session }
            );
            if (applied.modifiedCount !== 1) {
              logger.warn(`verifyPayment: coupon usage race order=${orderId}`);
            }
          }
        }
      }

      fresh.paymentStatus = 'paid';
      fresh.status = 'confirmed';
      fresh.razorpayPaymentId = razorpayPaymentId;
      fresh.razorpaySignature = razorpaySignature;
      fresh.statusHistory.push({
        status: 'confirmed',
        timestamp: new Date(),
        note: 'Payment received',
      });
      await fresh.save({ session });
    });
    } finally {
      await session.endSession();
    }

  const updated = await Order.findById(orderId).populate('items.product', 'name images');

  const notifyOnce = await tryClaimPaymentPlacedNotification(razorpayPaymentId);
  if (notifyOnce) {
    const userTemplate = emailTemplates.orderPlacedUser(
      req.user?.name || 'Customer',
      updated!.orderNumber,
      updated!.total
    );
    await enqueueEmail({
      to: req.user?.email || '',
      subject: userTemplate.subject,
      html: userTemplate.html,
    });

    const admins = await User.find({ role: 'admin', isActive: true }).select('email');
    const adminTemplate = emailTemplates.adminNewOrder(
      updated!.orderNumber,
      updated!.total,
      req.user?.name || 'Customer',
      req.user?.email || ''
    );
    await Promise.all(
      admins.map((a) =>
        enqueueEmail({
          to: a.email,
          subject: adminTemplate.subject,
          html: adminTemplate.html,
        })
      )
    );
  }

  res.status(200).json({
    status: 'success',
    message: 'Payment verified successfully',
    data: { order: updated },
  });
  } catch (err) {
    if (err instanceof AppError && err.statusCode < 500) {
      securityLog('payment.verify_failed', {
        orderId: payLockOrderId,
        statusCode: err.statusCode,
        message: err.message,
      });
    }
    throw err;
  } finally {
    await releasePaymentVerifyLock(payLockOrderId);
  }
});

export const getMyOrders = catchAsync(async (req: AuthRequest, res: Response) => {
  const page = parseInt((req.query.page as string) || '1', 10);
  const limit = parseInt((req.query.limit as string) || '10', 10);
  const skip = (page - 1) * limit;

  const [orders, total] = await Promise.all([
    Order.find({ user: req.user!._id })
      .sort('-createdAt')
      .skip(skip)
      .limit(limit)
      .populate('items.product', 'name images'),
    Order.countDocuments({ user: req.user!._id }),
  ]);

  res.status(200).json({
    status: 'success',
    pagination: { currentPage: page, totalPages: Math.ceil(total / limit), total },
    data: { orders },
  });
});

export const getOrderById = catchAsync(async (req: AuthRequest, res: Response, next: NextFunction) => {
  const order = await Order.findOne({
    _id: req.params.id,
    user: req.user!._id,
  }).populate('items.product', 'name images slug');

  if (!order) return next(new AppError('Order not found.', 404));

  res.status(200).json({ status: 'success', data: { order } });
});

export const cancelOrder = catchAsync(async (req: AuthRequest, res: Response, next: NextFunction) => {
  const order = await Order.findOne({ _id: req.params.id, user: req.user!._id });
  if (!order) return next(new AppError('Order not found.', 404));

  if (!['pending', 'confirmed'].includes(order.status)) {
    return next(new AppError('Order cannot be cancelled at this stage.', 400));
  }

  const shouldRestock =
    order.paymentMethod === 'cod' ||
    (order.paymentMethod === 'razorpay' && order.paymentStatus === 'paid');

  order.status = 'cancelled';
  order.statusHistory.push({
    status: 'cancelled',
    timestamp: new Date(),
    note: req.body.reason || 'Cancelled by customer',
  });

  if (shouldRestock) {
    for (const item of order.items) {
      await incrementVariantStock(item.product, item.variant.sku, item.quantity);
    }
  }

  await order.save();

  res.status(200).json({ status: 'success', data: { order } });
});
