import { Request, Response } from 'express';
import crypto from 'crypto';
import catchAsync from '../utils/catchAsync';
import logger from '../utils/logger';
import { securityLog } from '../utils/securityLog';
import { paymentReconciliationService } from '../services/paymentReconciliationService';

interface RazorpayWebhookPayload {
  event?: string;
  payload?: {
    payment?: {
      entity?: {
        id?: string;
        order_id?: string;
        status?: string;
      };
    };
  };
}

function verifyRazorpayWebhookSignature(rawBody: Buffer, signature: string, secret: string): boolean {
  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(signature, 'utf8');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

export const handleRazorpayWebhook = catchAsync(async (req: Request, res: Response) => {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET?.trim();
  if (!secret) {
    logger.error('RAZORPAY_WEBHOOK_SECRET is not configured');
    res.status(503).json({ status: 'error', message: 'Webhook not configured' });
    return;
  }

  const signature = req.headers['x-razorpay-signature'];
  if (typeof signature !== 'string' || !signature) {
    res.status(400).json({ status: 'error', message: 'Missing signature' });
    return;
  }

  const rawBody = req.body as Buffer;
  if (!Buffer.isBuffer(rawBody) || rawBody.length === 0) {
    res.status(400).json({ status: 'error', message: 'Invalid body' });
    return;
  }

  if (!verifyRazorpayWebhookSignature(rawBody, signature, secret)) {
    securityLog('payment.verify_failed', { message: 'webhook_invalid_signature' });
    res.status(400).json({ status: 'error', message: 'Invalid signature' });
    return;
  }

  let payload: RazorpayWebhookPayload;
  try {
    payload = JSON.parse(rawBody.toString('utf8')) as RazorpayWebhookPayload;
  } catch {
    res.status(400).json({ status: 'error', message: 'Invalid JSON' });
    return;
  }

  const event = payload.event ?? '';
  securityLog('payment.webhook_received', { event });

  const relevant = event === 'payment.captured' || event === 'payment.authorized' || event === 'order.paid';
  if (!relevant) {
    res.status(200).json({ status: 'ok', message: 'ignored' });
    return;
  }

  const entity = payload.payload?.payment?.entity;
  const razorpayPaymentId = entity?.id;
  const razorpayOrderId = entity?.order_id;

  if (!razorpayPaymentId || !razorpayOrderId) {
    res.status(200).json({ status: 'ok', message: 'no_payment_entity' });
    return;
  }

  const result = await paymentReconciliationService.reconcileCapturedPayment(
    razorpayOrderId,
    razorpayPaymentId,
    'webhook',
  );

  res.status(200).json({ status: 'ok', reconcile: result.status });
});
