import Razorpay from 'razorpay';
import crypto from 'crypto';
import AppError from '../utils/AppError';

export const razorpayInstance = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID as string,
  key_secret: process.env.RAZORPAY_KEY_SECRET as string,
});

/** Razorpay payment entity (subset used for verification). */
interface RazorpayPaymentEntity {
  id: string;
  amount: number;
  order_id: string | null;
  status: string;
}

interface RazorpayOrderOptions {
  amount: number;
  currency?: string;
  receipt: string;
  notes?: Record<string, string>;
}

export const createRazorpayOrder = async (options: RazorpayOrderOptions) => {
  const order = await razorpayInstance.orders.create({
    amount: options.amount * 100,
    currency: options.currency || 'INR',
    receipt: options.receipt,
    notes: options.notes || {},
  });
  return order;
};

export const verifyRazorpaySignature = (
  razorpayOrderId: string,
  razorpayPaymentId: string,
  razorpaySignature: string
): boolean => {
  const secret = process.env.RAZORPAY_KEY_SECRET as string;
  const body = razorpayOrderId + '|' + razorpayPaymentId;
  const expectedSignature = crypto.createHmac('sha256', secret).update(body).digest('hex');

  const a = Buffer.from(expectedSignature, 'utf8');
  const b = Buffer.from(razorpaySignature, 'utf8');
  if (a.length !== b.length) {
    return false;
  }
  return crypto.timingSafeEqual(a, b);
};

/**
 * Confirms with Razorpay API that this payment belongs to this order and amount (server-side truth).
 */
export const assertRazorpayPaymentMatchesOrder = async (
  razorpayOrderId: string,
  razorpayPaymentId: string,
  orderTotalInr: number
): Promise<void> => {
  const payment = (await razorpayInstance.payments.fetch(
    razorpayPaymentId
  )) as unknown as RazorpayPaymentEntity;

  if (!payment.order_id || payment.order_id !== razorpayOrderId) {
    throw new AppError('Payment does not match this checkout.', 400);
  }

  const expectedPaise = Math.round(orderTotalInr * 100);
  if (Number(payment.amount) !== expectedPaise) {
    throw new AppError('Payment amount does not match order total.', 400);
  }

  const okStatus = payment.status === 'captured' || payment.status === 'authorized';
  if (!okStatus) {
    throw new AppError(`Payment not completed (status: ${payment.status}).`, 400);
  }
};

export const verifyPaymentAndThrow = (
  razorpayOrderId: string,
  razorpayPaymentId: string,
  razorpaySignature: string
): void => {
  const isValid = verifyRazorpaySignature(razorpayOrderId, razorpayPaymentId, razorpaySignature);
  if (!isValid) {
    throw new AppError('Payment verification failed. Invalid signature.', 400);
  }
};
