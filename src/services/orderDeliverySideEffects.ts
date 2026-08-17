import { onOrderMarkedDelivered } from "./coupon/couponUserStatsService";
import { sendOrderDeliveredNotifications } from "./orders/orderDeliveredNotificationService";

/** Side effects when an order transitions to delivered. */
export async function onOrderDelivered(
  orderId: string,
  userId: string,
): Promise<void> {
  await onOrderMarkedDelivered(userId);
  await sendOrderDeliveredNotifications(orderId);
}