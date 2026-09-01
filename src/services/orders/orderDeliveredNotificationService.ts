import Order from "../../models/Order";
import { orderInvoiceNumber } from "../../utils/documentNumbers";
import { isCustomerDeliverableEmail } from "../../types/utils/customerEmail";
import { emailTemplates } from "../emailService";
import { enqueueEmail } from "../../queues/emailQueue";
import { notifyUser } from "../notificationService";
import { getOrderDeliveredCopy } from "../notifications/orderNotificationCopy";
import {
  generateOrderInvoicePdf,
  invoicePdfFilename,
} from "./orderInvoicePdfService";
import logger from "../../types/utils/logger";

function paymentMethodLabel(method?: string): string {
  switch (method) {
    case "cod":
      return "Cash on Delivery";
    case "offline_upi":
      return "Offline — UPI";
    case "offline_cash":
      return "Offline — Cash";
    case "razorpay":
      return "Online payment";
    default:
      return "Online";
  }
}

async function ensureInvoiceGenerated(orderId: string): Promise<void> {
  await Order.findOneAndUpdate(
    {
      _id: orderId,
      $or: [
        { "invoice.isGenerated": { $ne: true } },
        { invoice: { $exists: false } },
      ],
    },
    {
      $set: {
        invoice: { isGenerated: true, generatedAt: new Date() },
      },
    },
  );
}

/**
 * Send delivered + tax invoice notification once per order (idempotent).
 * Email with PDF when deliverable; WhatsApp with invoice link when phone available.
 */
export async function sendOrderDeliveredNotifications(
  orderId: string,
): Promise<void> {
  await ensureInvoiceGenerated(orderId);

  const order = await Order.findById(orderId)
    .populate("user", "name email phone addresses.phone")
    .lean();
  if (!order || order.status !== "delivered") return;
  if (order.deliveryInvoiceEmailSentAt) return;

  const user = order.user as unknown as
    | { _id?: unknown; name?: string; email?: string; phone?: string }
    | undefined;
  const email = user?.email;
  const hasEmail = isCustomerDeliverableEmail(email);

  const claimed = await Order.findOneAndUpdate(
    { _id: orderId, deliveryInvoiceEmailSentAt: { $exists: false } },
    { $set: { deliveryInvoiceEmailSentAt: new Date() } },
    { new: false },
  ).select("_id");
  if (!claimed) return;

  const orderNumber = order.orderNumber || String(orderId);

  if (hasEmail && email) {
    let pdfBuffer: Buffer | undefined;
    try {
      pdfBuffer = await generateOrderInvoicePdf({
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
        items: (order.items || []).map((item) => ({
          name: item.name,
          quantity: item.quantity,
          price: item.price,
          variant: item.variant,
        })),
      });
    } catch (err) {
      logger.error({
        msg: "delivery_invoice_pdf_failed",
        orderId,
        error: err instanceof Error ? err.message : String(err),
      });
    }

    if (pdfBuffer) {
      const invoiceNumber = orderInvoiceNumber(orderNumber);
      const pdfFilename = invoicePdfFilename(orderNumber);
      const baseUrl = (process.env.FRONTEND_URL || "https://thehouseofrani.com").replace(
        /\/$/,
        "",
      );
      const invoiceUrl = `${baseUrl}/dashboard/orders/${encodeURIComponent(orderId)}/invoice`;
      const orderUrl = `${baseUrl}/dashboard/orders/${encodeURIComponent(orderId)}`;
      const inPersonOffline =
        order.offlineMeta?.fulfillment === "offline_handover";

      const tpl = emailTemplates.orderDeliveredWithInvoice(
        user?.name || "Customer",
        {
          orderNumber,
          invoiceNumber,
          invoiceDate:
            order.invoice?.generatedAt ||
            order.deliveredAt ||
            order.updatedAt ||
            new Date(),
          total: order.total,
          itemCount: order.items?.length ?? 0,
          paymentMethod: paymentMethodLabel(order.paymentMethod),
          paymentStatus: order.paymentStatus || "paid",
          inPersonOffline,
          invoiceUrl,
          orderUrl,
          pdfFilename,
        },
      );

      await enqueueEmail({
        to: email,
        subject: tpl.subject,
        html: tpl.html,
        attachments: [
          {
            filename: pdfFilename,
            content: pdfBuffer,
            contentType: "application/pdf",
          },
        ],
      });

      if (user?._id) {
        const copy = getOrderDeliveredCopy(orderNumber);
        await notifyUser(
          String(user._id),
          copy.title,
          `${copy.message} Your tax invoice (PDF) has been emailed and is available in your account.`,
          `/dashboard/orders/${orderId}/invoice`,
          copy.type,
        );
      }

      logger.info({
        msg: "delivery_invoice_email_queued",
        orderId,
        orderNumber,
        to: email,
        pdfBytes: pdfBuffer.length,
      });
    }
  } else {
    logger.info({
      msg: "delivery_invoice_email_skipped",
      orderId,
      reason: "no_deliverable_email",
    });
  }

  if (user?._id) {
    const isHandoverAtSale =
      order.offlineMeta?.fulfillment === "offline_handover";
    if (!isHandoverAtSale) {
      const { notifyWhatsAppOrderDelivered } = await import(
        "../whatsappNotifyService"
      );
      void notifyWhatsAppOrderDelivered({
        userId: String(user._id),
        orderId,
        orderNumber,
        total: order.total,
        customerName: user?.name || "Customer",
      }).catch(() => {});
    }
  }
}
