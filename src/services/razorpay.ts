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

/** Razorpay axios layer throws `{ statusCode, error: { description, code } }` — not an `Error`. */
function razorpayApiMessage(err: unknown): string {
  if (err && typeof err === 'object') {
    const o = err as {
      error?: { description?: string; field?: string };
      description?: string;
      message?: string;
    };
    if (o.error?.description) return o.error.description;
    if (typeof o.message === 'string' && o.message) return o.message;
    if (typeof o.description === 'string') return o.description;
  }
  if (err instanceof Error && err.message) return err.message;
  return 'Razorpay refund failed';
}

function razorpayHttpStatus(err: unknown): number | undefined {
  if (err && typeof err === 'object' && 'statusCode' in err) {
    const sc = (err as { statusCode?: number }).statusCode;
    return typeof sc === 'number' ? sc : undefined;
  }
  return undefined;
}

export const refundRazorpayPayment = async (
  razorpayPaymentId: string,
  amountInr: number,
  notes?: Record<string, string>
) => {
  try {
    let payment = (await razorpayInstance.payments.fetch(razorpayPaymentId)) as unknown as {
      amount: number;
      amount_refunded?: number;
      status: string;
    };

    const amountPaise = Number(payment.amount);

    if (payment.status === 'authorized') {
      await razorpayInstance.payments.capture(razorpayPaymentId, amountPaise, 'INR');
      payment = (await razorpayInstance.payments.fetch(razorpayPaymentId)) as unknown as {
        amount: number;
        amount_refunded?: number;
        status: string;
      };
    }

    if (payment.status !== 'captured') {
      throw new AppError(
        `Cannot refund this payment yet (status: ${payment.status}).`,
        400
      );
    }

    const capturedPaise = Number(payment.amount);
    const alreadyRefunded = Number(payment.amount_refunded ?? 0);
    const refundablePaise = capturedPaise - alreadyRefunded;
    if (refundablePaise <= 0) {
      throw new AppError('This payment has already been fully refunded.', 400);
    }

    const requestedPaise = Math.round(Number(amountInr.toFixed(2)) * 100);
    if (requestedPaise > refundablePaise) {
      throw new AppError(
        `Refund amount exceeds what can still be refunded (max ₹${(refundablePaise / 100).toFixed(2)}).`,
        400
      );
    }

    const body: { amount?: number; notes?: Record<string, string> } = {};
    if (notes && Object.keys(notes).length > 0) {
      body.notes = notes;
    }

    const refundFullRemaining = requestedPaise >= refundablePaise;
    if (!refundFullRemaining) {
      body.amount = requestedPaise;
    }

    const refund = await razorpayInstance.payments.refund(razorpayPaymentId, body);
    return refund;
  } catch (error: unknown) {
    if (error instanceof AppError) throw error;
    const msg = razorpayApiMessage(error);
    const http = razorpayHttpStatus(error);
    const code =
      http !== undefined && http >= 400 && http < 500 ? http
      : http !== undefined && http >= 500 ? 502
      : 400;
    throw new AppError(msg, code);
  }
};
