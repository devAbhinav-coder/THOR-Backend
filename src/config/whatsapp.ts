function envFlag(name: string, fallback = false): boolean {
  const v = process.env[name]?.trim().toLowerCase();
  if (v === "true") return true;
  if (v === "false") return false;
  return fallback;
}

export function whatsappConfigured(): boolean {
  return Boolean(
    process.env.WHATSAPP_ACCESS_TOKEN?.trim() &&
      process.env.WHATSAPP_PHONE_NUMBER_ID?.trim(),
  );
}

export function whatsappEnabled(): boolean {
  return envFlag("WHATSAPP_ENABLED", true) && whatsappConfigured();
}

export function whatsappMarketingEnabled(): boolean {
  return whatsappEnabled() && envFlag("WHATSAPP_MARKETING_ENABLED", true);
}

export const whatsappConfig = {
  graphVersion: process.env.WHATSAPP_GRAPH_VERSION?.trim() || "v21.0",
  accessToken: process.env.WHATSAPP_ACCESS_TOKEN?.trim() || "",
  phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID?.trim() || "",
  language: process.env.WHATSAPP_TEMPLATE_LANG?.trim() || "en",
  templates: {
    orderConfirm: process.env.WHATSAPP_TEMPLATE_ORDER_CONFIRM?.trim() || "",
    orderStatus: process.env.WHATSAPP_TEMPLATE_ORDER_STATUS?.trim() || "",
    shipped: process.env.WHATSAPP_TEMPLATE_SHIPPED?.trim() || "",
    delivered: process.env.WHATSAPP_TEMPLATE_ORDER_DELIVERED?.trim() || "",
    cancelled: process.env.WHATSAPP_TEMPLATE_ORDER_CANCELLED?.trim() || "",
    offlineThankYou:
      process.env.WHATSAPP_TEMPLATE_OFFLINE_THANKYOU?.trim() ||
      process.env.WHATSAPP_TEMPLATE_ORDER_CONFIRM?.trim() ||
      "",
    offlineHandover:
      process.env.WHATSAPP_TEMPLATE_OFFLINE_HANDOVER?.trim() ||
      process.env.WHATSAPP_TEMPLATE_OFFLINE_THANKYOU?.trim() ||
      process.env.WHATSAPP_TEMPLATE_ORDER_DELIVERED?.trim() ||
      "",
    abandonedCart: process.env.WHATSAPP_TEMPLATE_ABANDONED?.trim() || "",
    reviewInvite: process.env.WHATSAPP_TEMPLATE_REVIEW_INVITE?.trim() || "",
    catalog: process.env.WHATSAPP_TEMPLATE_CATALOG?.trim() || "",
  },
};

export type WhatsAppTemplateKey = keyof typeof whatsappConfig.templates;

export const whatsAppTemplateLabels: Record<WhatsAppTemplateKey, string> = {
  orderConfirm: "Order placed / confirmed",
  orderStatus: "Status update (COD confirmed, processing, refund)",
  shipped: "Order shipped",
  delivered: "Order delivered + invoice",
  cancelled: "Order cancelled",
  offlineThankYou: "Offline order thank-you (courier create)",
  offlineHandover: "In-person handover thank-you + invoice link",
  abandonedCart: "Abandoned cart recovery",
  reviewInvite: "Review invite",
  catalog: "Catalog / marketing alert",
};

export const whatsAppAutomatedTriggers = [
  {
    id: "order_status",
    label: "Order status updates (confirmed, processing, refund)",
    templateKey: "orderStatus" as WhatsAppTemplateKey,
    schedule: "When admin updates order status — COD accepted, processing, etc.",
  },
  {
    id: "order_cancelled",
    label: "Order cancelled",
    templateKey: "cancelled" as WhatsAppTemplateKey,
    schedule: "When admin or system cancels an order",
  },
  {
    id: "order_confirm",
    label: "Order placed / confirmed",
    templateKey: "orderConfirm" as WhatsAppTemplateKey,
    schedule: "Immediate (order worker)",
  },
  {
    id: "order_shipped",
    label: "Order shipped",
    templateKey: "shipped" as WhatsAppTemplateKey,
    schedule: "When admin marks shipped",
  },
  {
    id: "order_delivered",
    label: "Order delivered + invoice PDF",
    templateKey: "delivered" as WhatsAppTemplateKey,
    schedule: "When order marked delivered — thank-you, invoice link, PDF (online + offline courier)",
  },
  {
    id: "offline_handover",
    label: "In-person handover thank-you + invoice PDF",
    templateKey: "offlineHandover" as WhatsAppTemplateKey,
    schedule: "Offline handover order created — thank-you, invoice link, PDF on WhatsApp",
  },
  {
    id: "offline_thankyou",
    label: "Offline courier thank-you (create only)",
    templateKey: "offlineThankYou" as WhatsAppTemplateKey,
    schedule: "Offline courier order created — thank-you only (invoice on delivery)",
  },
  {
    id: "review_invite",
    label: "Review invite with link",
    templateKey: "reviewInvite" as WhatsAppTemplateKey,
    schedule: "Manual admin send · auto 3 days after delivery",
  },
  {
    id: "abandoned_cart",
    label: "Abandoned cart reminder",
    templateKey: "abandonedCart" as WhatsAppTemplateKey,
    schedule: "Auto — 2h inactive cart (hourly job)",
  },
  {
    id: "catalog_alert",
    label: "New product / coupon / sale alert",
    templateKey: "catalog" as WhatsAppTemplateKey,
    schedule: "When admin publishes catalog/marketing items",
  },
  {
    id: "marketing_campaign",
    label: "Admin marketing broadcast",
    templateKey: "catalog" as WhatsAppTemplateKey,
    schedule: "Manual — Marketing campaigns page",
  },
] as const;

export function toWhatsAppMsisdn(phone?: string | null): string | null {
  const digits = String(phone || "").replace(/\D/g, "");
  if (digits.length === 10 && /^[6-9]/.test(digits)) return `91${digits}`;
  if (digits.length === 12 && digits.startsWith("91") && /^91[6-9]/.test(digits)) {
    return digits;
  }
  return null;
}
