import { Queue } from "bullmq";
import { isRedisOperational, getBullMqQueueConnection } from "../config/redis";
import logger from "../types/utils/logger";
import { OrderEventPayload } from "../events/orderEvents";
import { recordOrderMetric } from "../services/orderMetricsService";
import { bullmqRetention } from "../config/bullmqRetention";

export const orderQueue =
  isRedisOperational() ?
    new Queue<OrderEventPayload>("orderQueue", {
      connection: getBullMqQueueConnection(),
    })
  : null;

/** BullMQ rejects custom jobId values that contain `:`. */
function buildJobId(payload: OrderEventPayload): string {
  return `${payload.eventType}__${payload.orderId}`;
}

export const enqueueOrderEvent = async (
  payload: OrderEventPayload,
): Promise<void> => {
  if (orderQueue) {
    try {
      await orderQueue.add(payload.eventType as string, payload, {
        jobId: buildJobId(payload),
        attempts: 5,
        backoff: { type: "exponential", delay: 2000 },
        removeOnComplete: bullmqRetention.removeOnComplete,
        removeOnFail: bullmqRetention.removeOnFail,
      });
      logger.info(
        `Queued order event: ${payload.eventType} for order ${payload.orderNumber}`,
      );
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "enqueue failed";
      if (message.includes("Job") && message.includes("exists")) {
        logger.info(
          `Order event deduplicated: ${payload.eventType} ${payload.orderId}`,
        );
        return;
      }
      recordOrderMetric("order.cancel.queue_failure", {
        eventType: payload.eventType,
      });
      logger.error({
        msg: "order_event_enqueue_failed",
        eventType: payload.eventType,
        orderId: payload.orderId,
        error: message,
      });
      throw err instanceof Error ? err : new Error(message);
    }
  } else {
    logger.warn(
      `Redis is disabled, skipping order event queueing for ${payload.eventType}`,
    );
  }
};
