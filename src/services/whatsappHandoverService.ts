import {
  sendWhatsAppDocument,
  sendWhatsAppTemplate,
  uploadWhatsAppMedia,
  whatsAppTemplateUrlSuffix,
} from "./whatsappCloudService";
import { whatsappConfig, whatsappEnabled } from "../config/whatsapp";
import { invoicePdfFilename } from "./orders/orderInvoicePdfService";
import { buildOrderInvoicePdfBuffer } from "./orders/orderInvoicePdfBuffer";
import type { WhatsAppMessageCategory } from "../models/WhatsAppMessageLog";
import {
  logWhatsAppQueued,
  logWhatsAppResult,
} from "./whatsappLogService";
import logger from "../types/utils/logger";

const frontendUrl = (process.env.FRONTEND_URL || "https://thehouseofrani.com").replace(
  /\/$/,
  "",
);

function invoicePageUrl(orderId: string): string {
  return `${frontendUrl}/dashboard/orders/${encodeURIComponent(orderId)}/invoice`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

type InvoicePackBase = {
  to: string;
  userId: string;
  orderId: string;
  orderNumber: string;
  total: number;
  customerName: string;
};

async function sendWhatsAppInvoicePdf(opts: {
  to: string;
  userId: string;
  orderId: string;
  orderNumber: string;
  category: WhatsAppMessageCategory;
  caption: string;
}): Promise<boolean> {
  const pdfBuffer = await buildOrderInvoicePdfBuffer(opts.orderId);
  if (!pdfBuffer) {
    logger.info({
      msg: "whatsapp_invoice_pdf_skipped",
      orderId: opts.orderId,
      reason: "pdf_generation_failed",
    });
    return false;
  }

  const filename = invoicePdfFilename(opts.orderNumber);
  const docLogId = await logWhatsAppQueued({
    to: opts.to,
    template: `document:${filename}`,
    category: opts.category,
    bodyParams: ["Tax invoice PDF"],
    userId: opts.userId,
    orderId: opts.orderId,
  });

  const upload = await uploadWhatsAppMedia({
    buffer: pdfBuffer,
    mimeType: "application/pdf",
    filename,
  });

  if (!upload.ok || !upload.mediaId) {
    await logWhatsAppResult(docLogId, {
      ok: false,
      errorMessage: upload.errorMessage || "Media upload failed",
    });
    return false;
  }

  const docResult = await sendWhatsAppDocument({
    to: opts.to,
    mediaId: upload.mediaId,
    filename,
    caption: opts.caption,
  });
  await logWhatsAppResult(docLogId, docResult);
  return docResult.ok;
}

async function sendTemplateThenPdf(opts: {
  pack: InvoicePackBase;
  templateName: string;
  category: WhatsAppMessageCategory;
  bodyParams: string[];
  invoiceUrl: string;
  pdfCaption: string;
}): Promise<void> {
  if (!whatsappEnabled() || !opts.templateName) {
    logger.warn({
      msg: "whatsapp_invoice_pack_template_missing",
      orderId: opts.pack.orderId,
      category: opts.category,
    });
    return;
  }

  const templateLogId = await logWhatsAppQueued({
    to: opts.pack.to,
    template: opts.templateName,
    category: opts.category,
    bodyParams: opts.bodyParams,
    userId: opts.pack.userId,
    orderId: opts.pack.orderId,
  });

  const templateResult = await sendWhatsAppTemplate({
    to: opts.pack.to,
    template: opts.templateName,
    bodyParams: opts.bodyParams,
    buttonUrl: whatsAppTemplateUrlSuffix(opts.invoiceUrl),
  });
  await logWhatsAppResult(templateLogId, templateResult);

  if (!templateResult.ok) {
    logger.warn({
      msg: "whatsapp_invoice_pack_template_failed",
      orderId: opts.pack.orderId,
      error: templateResult.errorMessage,
    });
  }

  await sleep(600);

  const pdfOk = await sendWhatsAppInvoicePdf({
    to: opts.pack.to,
    userId: opts.pack.userId,
    orderId: opts.pack.orderId,
    orderNumber: opts.pack.orderNumber,
    category: opts.category,
    caption: opts.pdfCaption,
  });

  if (pdfOk) {
    logger.info({
      msg: "whatsapp_invoice_pack_complete",
      orderId: opts.pack.orderId,
      orderNumber: opts.pack.orderNumber,
      category: opts.category,
    });
  }
}

/** In-person handover — thank-you + invoice link + PDF. */
export async function processWhatsAppHandoverPack(opts: InvoicePackBase): Promise<void> {
  const tpl =
    whatsappConfig.templates.offlineHandover ||
    whatsappConfig.templates.offlineThankYou;
  const invoiceUrl = invoicePageUrl(opts.orderId);
  const firstName = opts.customerName.split(/\s+/)[0] || "there";

  await sendTemplateThenPdf({
    pack: opts,
    templateName: tpl,
    category: "offline_handover",
    bodyParams: [
      firstName,
      opts.orderNumber,
      `₹${opts.total.toFixed(0)}`,
      invoiceUrl,
    ],
    invoiceUrl,
    pdfCaption: `Thank you for shopping with The House of Rani! Tax invoice for order ${opts.orderNumber}.`,
  });
}

/** Order delivered (online / offline courier) — delivered thank-you + invoice link + PDF. */
export async function processWhatsAppDeliveredPack(opts: InvoicePackBase): Promise<void> {
  const tpl = whatsappConfig.templates.delivered;
  const invoiceUrl = invoicePageUrl(opts.orderId);
  const firstName = opts.customerName.split(/\s+/)[0] || "there";

  await sendTemplateThenPdf({
    pack: opts,
    templateName: tpl,
    category: "order_delivered",
    bodyParams: [
      firstName,
      opts.orderNumber,
      `₹${opts.total.toFixed(0)}`,
      invoiceUrl,
    ],
    invoiceUrl,
    pdfCaption: `Your order ${opts.orderNumber} has been delivered. Tax invoice from The House of Rani.`,
  });
}

export function orderInvoicePublicUrl(orderId: string): string {
  return invoicePageUrl(orderId);
}
