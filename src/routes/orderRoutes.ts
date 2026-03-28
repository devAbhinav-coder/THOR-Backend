import { Router } from 'express';
import {
  createOrder,
  verifyPayment,
  getMyOrders,
  getOrderById,
  cancelOrder,
} from '../controllers/orderController';
import { protect } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { createOrderSchema, verifyPaymentSchema } from '../validation/schemas';

const router = Router();

router.use(protect);

router.post('/', validate(createOrderSchema), createOrder);
router.post('/verify-payment', validate(verifyPaymentSchema), verifyPayment);
router.get('/my-orders', getMyOrders);
router.get('/:id', getOrderById);
router.patch('/:id/cancel', cancelOrder);

export default router;
