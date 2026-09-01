import Order from "../../models/Order";
import { isCustomerDeliverableEmail } from "../../types/utils/customerEmail";
import { emailTemplates } from "../emailService";
import { enqueueEmail } from "../../queues/emailQueue";
import { reviewInviteService } from "../reviewInvite/reviewInviteService";
import { onOrderMarkedDelivered } from "../coupon/couponUserStatsService";
import { buildOrderInvoicePdfBuffer } from "./orderInvoicePdfBuffer";
import { invoicePdfFilename } from "./orderInvoicePdfService";
import logger from "../../types/utils/logger";

type OfflineLineItem = { name: string; qty: number; lineTotal: number };

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

async function sendThankYouEmail(opts: {
  orderId: string;
  orderNumber: string;
  total: number;
  customerName: string;
  email: string;
  fulfillment: "delhivery" | "offline_handover";
  paymentLabel: string;
  items: OfflineLineItem[];
  pdfBuffer?: Buffer;
}): Promise<void> {
  const tpl = emailTemplates.offlineOrderThankYou(
    opts.customerName,
    opts.orderNumber,
    opts.total,
    {
      orderId: opts.orderId,
      fulfillment: opts.fulfillment,
      paymentLabel: opts.paymentLabel,
      items: opts.items,
      pdfAttached: Boolean(opts.pdfBuffer),
    },
  );

  if (opts.pdfBuffer) {
    const pdfFilename = invoicePdfFilename(opts.orderNumber);
    await enqueueEmail({
      to: opts.email,
      subject: tpl.subject,
      html: tpl.html,
      attachments: [
        {
          filename: pdfFilename,
          content: opts.pdfBuffer,
          contentType: "application/pdf",
        },
      ],
    });
    await Order.findByIdAndUpdate(opts.orderId, {
      deliveryInvoiceEmailSentAt: new Date(),
    }).catch(() => {});
  } else {
    await enqueueEmail({
      to: opts.email,
      subject: tpl.subject,
      html: tpl.html,
    });
  }
}

/**
 * Customer notifications when admin creates an offline / B2B order.
 *
 * Handover: thank-you + PDF (email) · thank-you + invoice link + PDF (WhatsApp) · review both channels
 * Courier: thank-you only on create · invoice on delivery (same as online)
 */
export async function sendOfflineOrderCreatedCustomerNotifications(opts: {
  orderId: string;
  userId: string;
  isHandover: boolean;
  fulfillment: "delhivery" | "offline_handover";
  paymentLabel: string;
  emailLineItems: OfflineLineItem[];
}): Promise<void> {
  const { orderId, userId, isHandover, fulfillment, paymentLabel, emailLineItems } =
    opts;

  const order = await Order.findById(orderId)
    .populate("user", "name email")
    .lean();
  if (!order) return;

  const user = order.user as unknown as { name?: string; email?: string } | undefined;
  const email = user?.email;
  const hasEmail = isCustomerDeliverableEmail(email);
  const customerName = user?.name || "Customer";

  if (isHandover) {
    await ensureInvoiceGenerated(orderId);
    await onOrderMarkedDelivered(userId).catch(() => {});

    const pdfBuffer = await buildOrderInvoicePdfBuffer(orderId);

    if (hasEmail && email) {
      await sendThankYouEmail({
        orderId,
        orderNumber: order.orderNumber,
        total: order.total,
        customerName,
        email,
        fulfillment: "offline_handover",
        paymentLabel,
        items: emailLineItems,
        pdfBuffer,
      });
    }

    const { notifyWhatsAppOfflineHandover } = await import("../whatsappNotifyService");
    void notifyWhatsAppOfflineHandover({
      userId,
      orderId,
      orderNumber: order.orderNumber,
      total: order.total,
      customerName,
    }).catch(() => {});

    try {
      await reviewInviteService.sendInviteAuto(orderId);
    } catch (err: unknown) {
      logger.info({
        msg: "offline_handover_review_invite_skipped",
        orderId,
        reason: err instanceof Error ? err.message : "review invite failed",
      });
    }
    return;
  }

  if (hasEmail && email) {
    await sendThankYouEmail({
      orderId,
      orderNumber: order.orderNumber,
      total: order.total,
      customerName,
      email,
      fulfillment,
      paymentLabel,
      items: emailLineItems,
    });
  }

  const { notifyWhatsAppOfflineThankYou } = await import("../whatsappNotifyService");
  void notifyWhatsAppOfflineThankYou({
    userId,
    orderId,
    orderNumber: order.orderNumber,
    total: order.total,
  }).catch(() => {});
}
