import { Worker, Job } from "bullmq";
import { redisEnabled, getBullMqWorkerConnection } from "../config/redis";
import logger from "../types/utils/logger";
import { OrderEventType, OrderEventPayload } from "../events/orderEvents";
import { emailTemplates } from "../services/emailService";
import { enqueueEmail } from "../queues/emailQueue";
import {
  notifyAdminsEmail,
  notifyAdmins,
  notifyUser,
} from "../services/notificationService";
import {
  getOnlineOrderCancelledCopy,
  getOnlineOrderPaidCopy,
  getOnlineOrderPlacedCopy,
} from "../services/notifications/orderNotificationCopy";
import { sendPurchaseEvent } from "../services/metaCapiService";
import Order from "../models/Order";

export let orderWorker: Worker<OrderEventPayload> | null = null;

export const startOrderWorker = () => {
  if (!redisEnabled) return;
  orderWorker = new Worker<OrderEventPayload>(
    "orderQueue",
    async (job: Job<OrderEventPayload>) => {
      const payload = job.data;
      logger.info(
        `Processing ${payload.eventType} for order ${payload.orderNumber}`,
      );

      switch (payload.eventType) {
        case OrderEventType.ORDER_CREATED: {
          // Send emails
          const userTemplate = emailTemplates.orderPlacedUser(
            payload.userName || "Customer",
            payload.orderNumber,
            payload.total,
          );
          if (payload.userEmail) {
            await enqueueEmail({
              to: payload.userEmail,
              subject: userTemplate.subject,
              html: userTemplate.html,
            });
          }

          const adminTemplate = emailTemplates.adminNewOrder(
            payload.orderNumber,
            payload.total,
            payload.userName || "Customer",
            payload.userEmail || "",
          );
          await notifyAdminsEmail(adminTemplate.subject, adminTemplate.html);

          // Notifications
          await notifyAdmins(
            "New Order Received",
            `Order ${payload.orderNumber} placed by ${payload.userName || "Customer"}.`,
            `/admin/orders/${payload.orderId}`,
            "order",
          );
          const placed = getOnlineOrderPlacedCopy(payload.orderNumber);
          await notifyUser(
            payload.userId,
            placed.title,
            placed.message,
            `/dashboard/orders/${payload.orderId}`,
            placed.type,
          );

          // Meta CAPI
          if (payload.paymentMethod === "cod") {
            // For cod, the order document is needed for meta capi formatting
            const order = await Order.findById(payload.orderId).lean();
            if (order) {
              await sendPurchaseEvent(
                order as any,
                payload.ip,
                payload.userAgent,
                payload.fbpCookie,
                payload.fbcCookie,
              );
            }
          }
          break;
        }

        case OrderEventType.ORDER_PAID: {
          const userTemplate = emailTemplates.orderPlacedUser(
            payload.userName || "Customer",
            payload.orderNumber,
            payload.total,
          );
          if (payload.userEmail) {
            await enqueueEmail({
              to: payload.userEmail,
              subject: userTemplate.subject,
              html: userTemplate.html,
            });
          }
          const adminTemplate = emailTemplates.adminNewOrder(
            payload.orderNumber,
            payload.total,
            payload.userName || "Customer",
            payload.userEmail || "",
          );
          await notifyAdminsEmail(adminTemplate.subject, adminTemplate.html);

          const paid = getOnlineOrderPaidCopy(payload.orderNumber);
          await notifyUser(
            payload.userId,
            paid.title,
            paid.message,
            `/dashboard/orders/${payload.orderId}`,
            paid.type,
          );
          await notifyAdmins(
            "New Order Received",
            `Order ${payload.orderNumber} verified by ${payload.userName || "Customer"}.`,
            `/admin/orders/${payload.orderId}`,
            "order",
          );

          const order = await Order.findById(payload.orderId).lean();
          if (order) {
            await sendPurchaseEvent(
              order as any,
              payload.ip,
              payload.userAgent,
              payload.fbpCookie,
              payload.fbcCookie,
            );
          }
          break;
        }

        case OrderEventType.ORDER_CANCELLED: {
          if (payload.userEmail) {
            const tpl = emailTemplates.userOrderCancelled(
              payload.userName || "Customer",
              payload.orderNumber,
              payload.cancelReason,
              "customer",
            );
            await enqueueEmail({
              to: payload.userEmail,
              subject: tpl.subject,
              html: tpl.html,
            });
          }
          const isRz = payload.paymentMethod === "razorpay";
          const cancelled = getOnlineOrderCancelledCopy(
            payload.orderNumber,
            isRz,
          );
          await notifyUser(
            payload.userId,
            cancelled.title,
            cancelled.message,
            `/dashboard/orders/${payload.orderId}`,
            cancelled.type,
          );

          if (payload.userEmail) {
            const adminTpl = emailTemplates.adminOrderCancelled(
              payload.userName || "Customer",
              payload.userEmail,
              payload.orderNumber,
              payload.orderId,
              payload.cancelReason,
              "customer",
            );
            await notifyAdminsEmail(adminTpl.subject, adminTpl.html);
          }
          await notifyAdmins(
            "Order Cancelled",
            `Order ${payload.orderNumber} was cancelled by ${payload.userName || "the customer"}.`,
            `/admin/orders/${payload.orderId}`,
            "alert",
          );
          break;
        }

        case OrderEventType.RETURN_REQUESTED: {
          if (payload.userEmail) {
            const tpl = emailTemplates.userReturnRequested(
              payload.userName || "Customer",
              payload.orderNumber,
              payload.returnReason || "",
              payload.refundMethod || "original_payment",
            );
            await enqueueEmail({
              to: payload.userEmail,
              subject: tpl.subject,
              html: tpl.html,
            });
          }
          const adminTemplate = emailTemplates.adminNewReturnRequest(
            payload.userName || "Customer",
            payload.userEmail || "",
            payload.orderNumber,
            payload.orderId,
            payload.returnReason || "",
            payload.refundMethod || "original_payment",
            payload.paymentMethod || "cod",
          );
          await notifyAdminsEmail(adminTemplate.subject, adminTemplate.html);
          await notifyAdmins(
            `Return Requested — ${payload.orderNumber}`,
            `${payload.userName || "Customer"} has requested a return. Reason: ${payload.returnReason}`,
            `/admin/orders/${payload.orderId}`,
            "alert",
          );
          break;
        }
      }
    },
    { connection: getBullMqWorkerConnection(), concurrency: 5 },
  );

  orderWorker.on("failed", (job, err) => {
    logger.error(
      `Order worker failed for job ${job?.id} (${job?.name}): ${err.message}`,
    );
  });

  logger.info("Order queue worker started");
};

export const closeOrderWorker = async () => {
  if (orderWorker) {
    await orderWorker.close();
  }
};
