import Order from "../../models/Order";
import { generateOrderInvoicePdf } from "./orderInvoicePdfService";
import logger from "../../types/utils/logger";

/** Build tax invoice PDF buffer for an order (shared by email + WhatsApp). */
export async function buildOrderInvoicePdfBuffer(
  orderId: string,
): Promise<Buffer | undefined> {
  const order = await Order.findById(orderId).lean();
  if (!order) return undefined;

  try {
    return await generateOrderInvoicePdf({
      orderNumber: order.orderNumber,
      createdAt: order.createdAt,
      deliveredAt: order.deliveredAt,
      invoice: order.invoice,
      paymentMethod: order.paymentMethod,
      paymentStatus: order.paymentStatus,
      razorpayPaymentId: order.razorpayPaymentId,
      subtotal: order.subtotal,
      discount: order.discount,
      shippingCharge: order.shippingCharge,
      codFee: order.codFee,
      tax: order.tax,
      total: order.total,
      offlineMeta: order.offlineMeta,
      shippingAddress: order.shippingAddress ?
        {
          name: order.shippingAddress.name,
          house: order.shippingAddress.house,
          street: order.shippingAddress.street,
          landmark: order.shippingAddress.landmark,
          city: order.shippingAddress.city,
          state: order.shippingAddress.state,
          pincode: order.shippingAddress.pincode,
          country: order.shippingAddress.country,
          phone: order.shippingAddress.phone,
        }
      : undefined,
      items: (order.items || []).map((item: { name: string; quantity: number; price: number; variant?: { size?: string; color?: string; sku?: string } }) => ({
        name: item.name,
        quantity: item.quantity,
        price: item.price,
        variant: item.variant,
      })),
    });
  } catch (err) {
    logger.error({
      msg: "order_invoice_pdf_buffer_failed",
      orderId,
      error: err instanceof Error ? err.message : String(err),
    });
    return undefined;
  }
}
