import Order from '../models/Order';
import { getCache, setCache } from './cacheService';
import {
  buildMyOrdersCacheKey,
  getUserOrdersCacheVersion,
} from './orderCacheService';
import { serializeOrderForClient, serializeOrdersForClient } from '../utils/orderClientSerializer';
import { recordOrderTiming } from './orderMetricsService';
import logger from '../utils/logger';
import { getRequestContext } from '../utils/requestContext';

const CACHE_TTL = 300; // 5 minutes
const QUERY_TIMEOUT_MS = 3000;
const DETAIL_TIMEOUT_MS = 2000;

/** List projection — lean reads without admin blobs */
const LIST_SELECT =
  'orderNumber user items shippingAddress status paymentStatus paymentMethod subtotal discount shippingCharge codFee tax total coupon productType customRequestId invoice returnStatus returnRequest refundData trackingNumber trackingUrl shippingCarrier shippedAt deliveredAt razorpayOrderId razorpayPaymentId createdAt updatedAt';

const DETAIL_SELECT = `${LIST_SELECT} statusHistory notes`;

export const orderReadService = {
  async getMyOrders(userId: string, skip: number, limit: number, statusStr?: string) {
    const started = Date.now();
    const query: Record<string, unknown> = { user: userId };
    if (statusStr) {
      if (statusStr.includes(',')) {
        query.status = { $in: statusStr.split(',').map((s) => s.trim()) };
      } else {
        query.status = statusStr;
      }
    }

    const version = await getUserOrdersCacheVersion(userId);
    const cacheKey = buildMyOrdersCacheKey(userId, version, skip, limit, statusStr);
    const cached = await getCache<{ orders: Record<string, unknown>[]; total: number }>(cacheKey);
    if (cached) {
      recordOrderTiming('order.fetch.list', Date.now() - started, { cache: 'hit' });
      return cached;
    }

    const [orders, total] = await Promise.all([
      Order.find(query)
        .select(LIST_SELECT)
        .sort('-createdAt')
        .skip(skip)
        .limit(limit)
        .lean()
        .maxTimeMS(QUERY_TIMEOUT_MS),
      Order.countDocuments(query).maxTimeMS(QUERY_TIMEOUT_MS),
    ]);

    const serialized = serializeOrdersForClient(orders as Record<string, unknown>[], {
      mode: 'list',
    });
    const result = { orders: serialized, total };
    await setCache(cacheKey, result, CACHE_TTL);
    recordOrderTiming('order.fetch.list', Date.now() - started, { cache: 'miss' });
    return result;
  },

  async getOrderById(orderId: string, userId: string) {
    const started = Date.now();
    const cacheKey = `cache:order:${orderId}:${userId}`;
    const cached = await getCache<Record<string, unknown>>(cacheKey);
    if (cached) {
      recordOrderTiming('order.fetch.detail', Date.now() - started, { cache: 'hit' });
      return cached;
    }

    const order = await Order.findOne({ _id: orderId, user: userId })
      .select(DETAIL_SELECT)
      .lean()
      .maxTimeMS(DETAIL_TIMEOUT_MS);

    if (!order) return null;

    const serialized = serializeOrderForClient(order as Record<string, unknown>, {
      mode: 'detail',
    });
    await setCache(cacheKey, serialized, CACHE_TTL);
    recordOrderTiming('order.fetch.detail', Date.now() - started, { cache: 'miss' });
    return serialized;
  },

  /** @deprecated Use orderCacheService.scheduleInvalidateUserOrderCache — kept for callers */
  async invalidateUserOrderCache(userId: string, orderId?: string) {
    const { invalidateUserOrderCache } = await import('./orderCacheService');
    await invalidateUserOrderCache(userId, orderId);
    const ctx = getRequestContext();
    logger.debug({
      msg: 'order_read_service_cache_invalidate',
      userId,
      orderId,
      requestId: ctx?.requestId,
    });
  },
};
