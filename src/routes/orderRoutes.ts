import { Router } from 'express';
import {
  createOrder,
  verifyPayment,
  getMyOrders,
  getOrderById,
  cancelOrder,
  prepareOrderPayment,
  requestReturn,
} from '../controllers/orderController';
import { protect } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { createOrderSchema, verifyPaymentSchema } from '../validation/schemas';
import { createAdaptiveLimiter } from '../middleware/adaptiveRateLimit';

const router = Router();
const paymentLimiter = createAdaptiveLimiter({
  windowMs: 10 * 60 * 1000,
  max: 40,
  prefix: 'rl:adaptive:orders:',
  message: 'Too many order/payment actions. Please wait and retry.',
});

router.use(protect);

router.post('/', paymentLimiter, validate(createOrderSchema), createOrder);
router.post('/verify-payment', paymentLimiter, validate(verifyPaymentSchema), verifyPayment);
router.get('/my-orders', getMyOrders);
router.get('/:id', getOrderById);
router.post('/:id/return', paymentLimiter, requestReturn);
router.post('/:orderId/prepare-payment', paymentLimiter, prepareOrderPayment);
router.patch('/:id/cancel', paymentLimiter, cancelOrder);

export default router;
