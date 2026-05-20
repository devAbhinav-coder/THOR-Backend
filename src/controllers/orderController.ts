import { Response, NextFunction } from 'express';
import AppError from '../utils/AppError';
import catchAsync from '../utils/catchAsync';
import { AuthRequest } from '../types';
import { sendSuccess, sendPaginated } from '../utils/response';
import { orderReadService } from '../services/orderReadService';
import { customerCancelOrder } from '../services/adminOrderService';
import { OrderEventType } from '../events/orderEvents';
import { writeAdminAudit } from '../services/adminAuditService';
import { scheduleInvalidateUserOrderCache } from '../services/orderCacheService';
import { recordOrderEvent } from '../services/orderEventOutboxService';
import { serializeOrderForClient } from '../utils/orderClientSerializer';
import { recordOrderMetric } from '../services/orderMetricsService';
import { securityLog } from '../utils/securityLog';
import logger from '../utils/logger';
import { getRequestContext } from '../utils/requestContext';

const DEFAULT_LIST_LIMIT = 10;

export const getMyOrders = catchAsync(async (req: AuthRequest, res: Response) => {
  const page = Number(req.query.page) || 1;
  const limit = Number(req.query.limit) || DEFAULT_LIST_LIMIT;
  const skip = (page - 1) * limit;
  const statusStr = req.query.status as string | undefined;

  const result = await orderReadService.getMyOrders(String(req.user!._id), skip, limit, statusStr);
  sendPaginated(res, { orders: result.orders }, { page, limit, total: result.total });
});

export const getOrderById = catchAsync(async (req: AuthRequest, res: Response, next: NextFunction) => {
  const order = await orderReadService.getOrderById(req.params.id, String(req.user!._id));
  if (!order) return next(new AppError('Order not found.', 404));
  sendSuccess(res, { order });
});

export const cancelOrder = catchAsync(async (req: AuthRequest, res: Response) => {
  const ctx = getRequestContext();
  const userId = String(req.user!._id);
  const orderId = req.params.id;
  const reason =
    String((req.body as { reason?: string })?.reason || 'Cancelled by customer')
      .trim()
      .slice(0, 500) || 'Cancelled by customer';

  recordOrderMetric('order.cancel.request', { userId, orderId });

  const { order, alreadyCancelled } = await customerCancelOrder(orderId, userId, reason);

  scheduleInvalidateUserOrderCache(userId, orderId);

  writeAdminAudit(req, 'order.cancelled.by_customer', {
    orderId,
    orderNumber: order.orderNumber,
    reason,
    alreadyCancelled,
    requestId: ctx?.requestId,
  }).catch((e: Error) =>
    logger.warn({
      msg: 'audit_log_failed',
      action: 'order.cancelled.by_customer',
      orderId,
      requestId: ctx?.requestId,
      error: e.message,
    })
  );

  const clientOrder = serializeOrderForClient(
    order.toJSON() as Record<string, unknown>,
    { mode: 'detail' }
  );

  if (alreadyCancelled) {
    recordOrderMetric('order.cancel.idempotent', { userId, orderId });
    return sendSuccess(res, { order: clientOrder }, 'Order already cancelled');
  }

  recordOrderMetric('order.cancel.success', { userId, orderId, reason: reason.slice(0, 80) });

  securityLog('order.cancel.by_customer', {
    userId,
    orderId,
    orderNumber: order.orderNumber,
  });

  recordOrderEvent({
    eventType: OrderEventType.ORDER_CANCELLED,
    orderId: String(order._id),
    orderNumber: order.orderNumber,
    userId,
    userName: req.user?.name,
    userEmail: req.user?.email,
    total: order.total,
    paymentMethod: order.paymentMethod,
    cancelReason: reason,
  }).catch((e: Error) => {
    recordOrderMetric('order.cancel.queue_failure', { userId, orderId });
    logger.error({
      msg: 'cancel_event_outbox_failed',
      orderNumber: order.orderNumber,
      orderId,
      requestId: ctx?.requestId,
      error: e.message,
    });
  });

  sendSuccess(res, { order: clientOrder });
});
