import Order from "../models/Order";
import mongoose from "mongoose";
import {
  buildMyOrdersCacheKey,
  getUserOrdersCacheVersion,
} from "./orderCacheService";
import {
  serializeOrderForClient,
  serializeOrdersForClient,
} from "../types/utils/orderClientSerializer";
import { recordOrderTiming } from "./orderMetricsService";
import logger from "../types/utils/logger";
import { getRequestContext } from "../types/utils/requestContext";
import { cachedFetch } from "./cache/cachedFetch";
import { sampleDbQuery } from "./observability/platformMetricsService";

const LIST_SOFT_TTL_SEC = 300;
const LIST_HARD_TTL_SEC = 900;
const QUERY_TIMEOUT_MS = 3000;
const DETAIL_TIMEOUT_MS = 2000;

/** List projection - lean reads without admin blobs */
const LIST_SELECT =
  "orderNumber user items shippingAddress status paymentStatus paymentMethod subtotal discount shippingCharge codFee tax total coupon productType customRequestId invoice returnStatus returnRequest refundData trackingNumber trackingUrl shippingCarrier shippedAt deliveredAt razorpayOrderId razorpayPaymentId createdAt updatedAt";

const DETAIL_SELECT = `${LIST_SELECT} statusHistory notes`;

export const orderReadService = {
  async getMyOrders(
    userId: string,
    skip: number,
    limit: number,
    statusStr?: string,
  ) {
    const started = Date.now();
    const version = await getUserOrdersCacheVersion(userId);
    const cacheKey = `${buildMyOrdersCacheKey(
      userId,
      version,
      skip,
      limit,
      statusStr,
    )}:env`;

    const result = await cachedFetch({
      key: cacheKey,
      softTtlSec: LIST_SOFT_TTL_SEC,
      hardTtlSec: LIST_HARD_TTL_SEC,
      fetchFresh: async () => {
        const query: Record<string, unknown> = { user: userId };
        if (statusStr) {
          if (statusStr.includes(",")) {
            query.status = { $in: statusStr.split(",").map((s) => s.trim()) };
          } else {
            query.status = statusStr;
          }
        }

        sampleDbQuery("orders", "find");
        sampleDbQuery("orders", "countDocuments");
        const [orders, total] = await Promise.all([
          Order.find(query)
            .select(LIST_SELECT)
            .sort("-createdAt")
            .skip(skip)
            .limit(limit)
            .lean()
            .maxTimeMS(QUERY_TIMEOUT_MS),
          Order.countDocuments(query).maxTimeMS(QUERY_TIMEOUT_MS),
        ]);

        const serialized = serializeOrdersForClient(
          orders as Record<string, unknown>[],
          { mode: "list" },
        );
        return { orders: serialized, total };
      },
    });

    recordOrderTiming("order.fetch.list", Date.now() - started, {
      cache: "cachedFetch",
    });
    return result;
  },

  async getMyOrdersSummary(userId: string) {
    const started = Date.now();
    const version = await getUserOrdersCacheVersion(userId);
    const cacheKey = `cache:my-orders-summary:v${version}:${userId}:env`;

    const result = await cachedFetch({
      key: cacheKey,
      softTtlSec: LIST_SOFT_TTL_SEC,
      hardTtlSec: LIST_HARD_TTL_SEC,
      fetchFresh: async () => {
        const ACTIVE = ["pending", "confirmed", "processing", "shipped"];
        sampleDbQuery("orders", "aggregate");
        const rows = await Order.aggregate<{
          total: number;
          delivered: number;
          inProgress: number;
        }>([
          { $match: { user: new mongoose.Types.ObjectId(userId) } },
          {
            $group: {
              _id: null,
              total: { $sum: 1 },
              delivered: {
                $sum: { $cond: [{ $eq: ["$status", "delivered"] }, 1, 0] },
              },
              inProgress: {
                $sum: {
                  $cond: [{ $in: ["$status", ACTIVE] }, 1, 0],
                },
              },
            },
          },
        ]).option({ maxTimeMS: QUERY_TIMEOUT_MS });

        const summary = rows[0] ?? { total: 0, delivered: 0, inProgress: 0 };
        return {
          total: summary.total || 0,
          delivered: summary.delivered || 0,
          inProgress: summary.inProgress || 0,
        };
      },
    });

    recordOrderTiming("order.fetch.summary", Date.now() - started, {
      cache: "cachedFetch",
    });
    return result;
  },

  async getOrderById(orderId: string, userId: string) {
    const started = Date.now();
    const cacheKey = `cache:order:${orderId}:${userId}:env`;

    const serialized = await cachedFetch({
      key: cacheKey,
      softTtlSec: LIST_SOFT_TTL_SEC,
      hardTtlSec: LIST_HARD_TTL_SEC,
      fetchFresh: async () => {
        sampleDbQuery("orders", "findOne");
        const order = await Order.findOne({ _id: orderId, user: userId })
          .select(DETAIL_SELECT)
          .lean()
          .maxTimeMS(DETAIL_TIMEOUT_MS);

        if (!order) return null;

        return serializeOrderForClient(order as Record<string, unknown>, {
          mode: "detail",
        });
      },
    });

    recordOrderTiming("order.fetch.detail", Date.now() - started, {
      cache: "cachedFetch",
    });
    return serialized;
  },

  /** @deprecated Use orderCacheService.scheduleInvalidateUserOrderCache - kept for callers */
  async invalidateUserOrderCache(userId: string, orderId?: string) {
    const { invalidateUserOrderCache } = await import("./orderCacheService");
    await invalidateUserOrderCache(userId, orderId);
    const ctx = getRequestContext();
    logger.debug({
      msg: "order_read_service_cache_invalidate",
      userId,
      orderId,
      requestId: ctx?.requestId,
    });
  },
};
