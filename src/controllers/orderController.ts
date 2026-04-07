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
import { refProductId } from '../utils/productStock';
import { notifyAdmins } from '../services/notificationService';
import { sendPaginated, sendSuccess } from '../utils/response';
import { orderRepository } from '../repositories/orderRepository';
import { buildOrderItemsFromProducts, computeOrderTotals, getGiftMinQty } from '../services/orderService';


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
  const { shippingAddress, paymentMethod, couponCode, notes, buyNowItem } = req.body;

  let checkoutItems: Array<{
    product: mongoose.Types.ObjectId | { _id: mongoose.Types.ObjectId };
    variant: { sku: string; size?: string; color?: string; colorCode?: string };
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
      return next(new AppError('Product is no longer available.', 400));
    }
    const minQty = getGiftMinQty(product);
    if (buyNowItem.quantity < minQty) {
      return next(new AppError(`Minimum quantity for "${product.name}" is ${minQty}.`, 400));
    }
    const variant = product.variants.find((v) => v.sku === buyNowItem.variant.sku);
    if (!variant || variant.stock < buyNowItem.quantity) {
      return next(new AppError(`Insufficient stock for "${product.name}".`, 400));
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
    const cart = await orderRepository.findCartForCheckout(String(req.user!._id));
    if (!cart || cart.items.length === 0) {
      return next(new AppError('Your cart is empty.', 400));
    }

    checkoutItems = cart.items;
    checkoutSubtotal = cart.subtotal;
    cartIdToDelete = cart._id as mongoose.Types.ObjectId;
    if (cart.coupon) {
      cartCouponDiscount = cart.discount;
      cartCouponId = cart.coupon as mongoose.Types.ObjectId;
    }

    const productIds = [...new Set(cart.items.map((i) => refProductId(i.product)))];
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
      return next(new AppError(`Minimum quantity for "${product.name}" is ${minQty}.`, 400));
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
      ).isValid(String(req.user!._id), checkoutSubtotal);
      if (validity.valid) {
        discount = (
          coupon as typeof coupon & { calculateDiscount: (amount: number) => number }
        ).calculateDiscount(checkoutSubtotal);
        couponId = coupon._id as mongoose.Types.ObjectId;
      }
    }
  } else if (cartCouponId) {
    discount = cartCouponDiscount;
    couponId = cartCouponId;
  }

  const { shippingCharge, tax, total } = computeOrderTotals(checkoutSubtotal, discount);

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
    tax,
    total,
    coupon: couponId,
    notes,
  };

  if (paymentMethod === 'razorpay') {
    const order = await orderRepository.createOrder(orderPayload);

    const razorpayOrder = await createRazorpayOrder({
      amount: total,
      receipt: order.orderNumber,
      notes: { orderId: String(order._id) },
    });

    order.razorpayOrderId = razorpayOrder.id;
    await order.save();

    if (cartIdToDelete) {
      await orderRepository.deleteCartById(cartIdToDelete);
    }

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
    sendSuccess(res, razorpayBody.data as Record<string, unknown>, 'Order created', 201);
    return;
  }

  const session = await mongoose.startSession();
  let codOrder: InstanceType<typeof Order> | undefined;
  try {
    await session.withTransaction(async () => {
      const created = await Order.create([orderPayload], { session });
      codOrder = created[0] as InstanceType<typeof Order>;

      for (const item of checkoutItems) {
        const ok = await decrementVariantStock(refProductId(item.product), item.variant.sku, item.quantity, { session });
        if (!ok) {
          throw new AppError(`Insufficient stock for a cart item. Please refresh and try again.`, 409);
        }
      }

      if (couponId) {
        const coupon = await Coupon.findById(couponId).session(session);
        if (!coupon) {
          throw new AppError('Coupon is no longer valid.', 400);
        }
        const validity = coupon.isValid(String(req.user!._id), checkoutSubtotal);
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

      if (cartIdToDelete) {
        await orderRepository.deleteCartByIdInSession(cartIdToDelete, session);
      }
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

  const admins = await orderRepository.findActiveAdminEmails();
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

  await notifyAdmins(
    'New Order Received',
    `Order ${codOrder.orderNumber} placed by ${req.user?.name || 'Customer'}.`,
    `/admin/orders/${codOrder._id}`,
    'order'
  );

  const codBody = { status: 'success' as const, data: { order: codOrder.toJSON() } };
  if (idemKey) {
    await setIdempotentCheckoutResponse(userId, idemKey, 201, codBody);
  }
  sendSuccess(res, codBody.data as Record<string, unknown>, 'Order created', 201);
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
    sendSuccess(res, { order }, 'Payment already verified');
    return;
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
        const ok = await decrementVariantStock(refProductId(item.product), item.variant.sku, item.quantity, { session });
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

    const admins = await orderRepository.findActiveAdminEmails();
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
    
    // In-App Notification
    await notifyAdmins(
      'New Order Received',
      `Order ${updated!.orderNumber} verified by ${req.user?.name || 'Customer'}.`,
      `/admin/orders/${updated!._id}`,
      'order'
    );
  }

  sendSuccess(res, { order: updated }, 'Payment verified successfully');
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

export const prepareOrderPayment = catchAsync(async (req: AuthRequest, res: Response, next: NextFunction) => {
  const { orderId } = req.params;

  const order = await Order.findOne({ _id: orderId, user: req.user!._id });
  if (!order) return next(new AppError('Order not found.', 404));

  if (order.paymentStatus === 'paid') {
    return next(new AppError('Order is already paid.', 400));
  }

  if (order.paymentMethod !== 'razorpay') {
    // If user wants to pay online for a COD order (optional, but good for custom)
    order.paymentMethod = 'razorpay';
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
      currency: 'INR',
      keyId: process.env.RAZORPAY_KEY_ID,
    },
  });
});

export const getMyOrders = catchAsync(async (req: AuthRequest, res: Response) => {
  const page = parseInt((req.query.page as string) || '1', 10);
  const limit = parseInt((req.query.limit as string) || '10', 10);
  const skip = (page - 1) * limit;
  const statusStr = req.query.status as string;

  const query: Record<string, unknown> = { user: req.user!._id };

  if (statusStr) {
    if (statusStr.includes(',')) {
      query.status = { $in: statusStr.split(',') };
    } else {
      query.status = statusStr;
    }
  }

  const [orders, total] = await Promise.all([
    orderRepository.findUserOrders(query, skip, limit),
    orderRepository.countOrders(query),
  ]);
  sendPaginated(res, { orders }, { page, limit, total });
});

export const getOrderById = catchAsync(async (req: AuthRequest, res: Response, next: NextFunction) => {
  const order = await Order.findOne({
    _id: req.params.id,
    user: req.user!._id,
  }).populate('items.product', 'name images slug');

  if (!order) return next(new AppError('Order not found.', 404));

  sendSuccess(res, { order });
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

  await notifyAdmins(
    'Order Cancelled',
    `Order ${order.orderNumber} was cancelled by ${req.user?.name || 'the customer'}.`,
    `/admin/orders/${order._id}`,
    'alert'
  );

  if (shouldRestock) {
    for (const item of order.items) {
      await incrementVariantStock(refProductId(item.product), item.variant.sku, item.quantity);
    }
  }

  await order.save();

  sendSuccess(res, { order });
});
