import { Router } from 'express';
import {
  getMyOrders,
  getOrderById,
  cancelOrder,
} from '../controllers/orderController';
import { createOrder } from '../controllers/checkoutController';
import { verifyPayment, prepareOrderPayment } from '../controllers/paymentController';
import { requestReturn } from '../controllers/returnController';
import { protect } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { createOrderSchema, verifyPaymentSchema } from '../validation/schemas';
import {
  getMyOrdersSchema,
  orderIdParamsSchema,
  cancelOrderSchema,
} from '../validation/orderSchemas';
import { createAdaptiveLimiter } from '../middleware/adaptiveRateLimit';

const router = Router();
const paymentLimiter = createAdaptiveLimiter({
  windowMs: 10 * 60 * 1000,
  max: 40,
  prefix: 'rl:adaptive:orders:',
  message: 'Too many order/payment actions. Please wait and retry.',
});

const cancelOrderLimiter = createAdaptiveLimiter({
  windowMs: 15 * 60 * 1000,
  max: Number(process.env.ORDER_CANCEL_RATE_MAX || 12),
  prefix: 'rl:adaptive:order-cancel:',
  message: 'Too many cancellation attempts. Please wait before trying again.',
});

router.use(protect);

router.post('/', paymentLimiter, validate(createOrderSchema), createOrder);
router.post('/verify-payment', paymentLimiter, validate(verifyPaymentSchema), verifyPayment);
router.get('/my-orders', validate(getMyOrdersSchema), getMyOrders);
router.get('/:id', validate(orderIdParamsSchema), getOrderById);
router.post('/:id/return', paymentLimiter, requestReturn);
router.post('/:orderId/prepare-payment', paymentLimiter, prepareOrderPayment);
router.patch('/:id/cancel', cancelOrderLimiter, validate(cancelOrderSchema), cancelOrder);

export default router;
