import User from "../models/User";
import {
  toWhatsAppMsisdn,
  whatsappConfig,
  whatsappEnabled,
  whatsappMarketingEnabled,
} from "../config/whatsapp";
import { enqueueWhatsApp, enqueueWhatsAppHandoverPack, enqueueWhatsAppDeliveredPack } from "../queues/whatsappQueue";
import type { WhatsAppMessageCategory } from "../models/WhatsAppMessageLog";
import logger from "../types/utils/logger";

const frontendUrl = process.env.FRONTEND_URL || "https://thehouseofrani.com";

type PhoneUser = {
  phone?: string | null;
  addresses?: Array<{ phone?: string | null }>;
  whatsappMarketingOptIn?: boolean;
  isActive?: boolean;
  role?: string;
  name?: string;
};

export function resolveUserWhatsApp(user: PhoneUser | null | undefined): string | null {
  if (!user) return null;
  return (
    toWhatsAppMsisdn(user.phone) ||
    toWhatsAppMsisdn(user.addresses?.find((a) => a.phone)?.phone)
  );
}

async function loadUserPhone(userId: string): Promise<{ to: string; name: string } | null> {
  if (!whatsappEnabled() || !userId) return null;
  const user = await User.findById(userId)
    .select("name phone addresses.phone isActive")
    .lean<PhoneUser & { name?: string }>();
  if (!user || user.isActive === false) return null;
  const to = resolveUserWhatsApp(user);
  if (!to) return null;
  return { to, name: user.name || "there" };
}

async function sendTemplate(opts: {
  to: string;
  template: string;
  bodyParams: string[];
  category: WhatsAppMessageCategory;
  userId?: string;
  orderId?: string;
  campaignSubject?: string;
}): Promise<void> {
  await enqueueWhatsApp(opts);
}

export async function notifyWhatsAppOrderConfirmed(opts: {
  userId: string;
  orderId?: string;
  orderNumber: string;
  total: number;
}): Promise<void> {
  const dest = await loadUserPhone(opts.userId);
  const tpl = whatsappConfig.templates.orderConfirm;
  if (!dest || !tpl) return;
  await sendTemplate({
    to: dest.to,
    template: tpl,
    bodyParams: [dest.name, opts.orderNumber, `₹${opts.total.toFixed(0)}`],
    category: "order_confirm",
    userId: opts.userId,
    orderId: opts.orderId,
  });
}

export async function notifyWhatsAppOrderShipped(opts: {
  userId: string;
  orderId?: string;
  orderNumber: string;
  carrier?: string;
  awb?: string;
}): Promise<void> {
  const dest = await loadUserPhone(opts.userId);
  const tpl = whatsappConfig.templates.shipped;
  if (!dest || !tpl) return;
  const track = [opts.carrier, opts.awb].filter(Boolean).join(" ") || "on the way";
  await sendTemplate({
    to: dest.to,
    template: tpl,
    bodyParams: [dest.name, opts.orderNumber, track],
    category: "order_shipped",
    userId: opts.userId,
    orderId: opts.orderId,
  });
}

function orderStatusWhatsAppDetail(
  status: string,
  orderNumber: string,
  opts?: { carrier?: string; awb?: string },
): string {
  switch (status) {
    case "confirmed":
      return `Order ${orderNumber} is confirmed — thank you for choosing The House of Rani!`;
    case "processing":
      return `We're preparing order ${orderNumber} with care. We'll message you when it ships.`;
    case "pending":
      return `We've received order ${orderNumber}. We'll confirm it shortly.`;
    case "refunded":
      return `Refund recorded for order ${orderNumber}. Check your account for details.`;
    case "cancelled":
      return `Order ${orderNumber} has been cancelled. Contact us if you need help.`;
    case "shipped": {
      const track = [opts?.carrier, opts?.awb].filter(Boolean).join(" ");
      return track ?
          `Order ${orderNumber} has shipped — ${track}`
        : `Order ${orderNumber} is on the way!`;
    }
    default:
      return `Update on order ${orderNumber}: ${status}`;
  }
}

/** Admin status change — confirmed (COD accepted), processing, refunded, etc. */
export async function notifyWhatsAppOrderStatusChange(opts: {
  userId: string;
  orderId: string;
  orderNumber: string;
  status: string;
  carrier?: string;
  awb?: string;
}): Promise<void> {
  const status = String(opts.status || "").toLowerCase();
  if (!status || status === "delivered") return;

  if (status === "shipped") {
    await notifyWhatsAppOrderShipped({
      userId: opts.userId,
      orderId: opts.orderId,
      orderNumber: opts.orderNumber,
      carrier: opts.carrier,
      awb: opts.awb,
    });
    return;
  }

  if (status === "cancelled") {
    await notifyWhatsAppOrderCancelled({
      userId: opts.userId,
      orderId: opts.orderId,
      orderNumber: opts.orderNumber,
    });
    return;
  }

  const dest = await loadUserPhone(opts.userId);
  const tpl =
    whatsappConfig.templates.orderStatus ||
    whatsappConfig.templates.orderConfirm;
  if (!dest || !tpl) return;

  const orderUrl = `${frontendUrl}/dashboard/orders/${encodeURIComponent(opts.orderId)}`;
  const detail = orderStatusWhatsAppDetail(status, opts.orderNumber, opts);

  await sendTemplate({
    to: dest.to,
    template: tpl,
    bodyParams: [
      dest.name.split(/\s+/)[0] || "there",
      opts.orderNumber,
      detail,
      orderUrl,
    ],
    category: status === "confirmed" ? "order_confirm" : "order_status",
    userId: opts.userId,
    orderId: opts.orderId,
  });
}

export async function notifyWhatsAppOrderCancelled(opts: {
  userId: string;
  orderId?: string;
  orderNumber: string;
}): Promise<void> {
  const dest = await loadUserPhone(opts.userId);
  const tpl =
    whatsappConfig.templates.cancelled ||
    whatsappConfig.templates.orderStatus ||
    whatsappConfig.templates.orderConfirm;
  if (!dest || !tpl) return;

  const orderUrl = opts.orderId ?
    `${frontendUrl}/dashboard/orders/${encodeURIComponent(opts.orderId)}`
  : `${frontendUrl}/dashboard/orders`;

  await sendTemplate({
    to: dest.to,
    template: tpl,
    bodyParams: [
      dest.name.split(/\s+/)[0] || "there",
      opts.orderNumber,
      orderStatusWhatsAppDetail("cancelled", opts.orderNumber),
      orderUrl,
    ],
    category: "order_cancelled",
    userId: opts.userId,
    orderId: opts.orderId,
  });
}

export async function notifyWhatsAppOrderDelivered(opts: {
  userId: string;
  orderId: string;
  orderNumber: string;
  total: number;
  customerName?: string;
}): Promise<void> {
  if (!whatsappEnabled()) return;
  const dest = await loadUserPhone(opts.userId);
  if (!dest) return;

  await enqueueWhatsAppDeliveredPack({
    to: dest.to,
    userId: opts.userId,
    orderId: opts.orderId,
    orderNumber: opts.orderNumber,
    total: opts.total,
    customerName: opts.customerName || dest.name,
  });
}

export async function notifyWhatsAppOfflineThankYou(opts: {
  userId: string;
  orderId?: string;
  orderNumber: string;
  total: number;
}): Promise<void> {
  const dest = await loadUserPhone(opts.userId);
  const tpl = whatsappConfig.templates.offlineThankYou;
  if (!dest || !tpl) return;
  await sendTemplate({
    to: dest.to,
    template: tpl,
    bodyParams: [dest.name, opts.orderNumber, `₹${opts.total.toFixed(0)}`],
    category: "offline_thankyou",
    userId: opts.userId,
    orderId: opts.orderId,
  });
}

/** In-person handover: thank-you template + invoice link + PDF document on WhatsApp. */
export async function notifyWhatsAppOfflineHandover(opts: {
  userId: string;
  orderId: string;
  orderNumber: string;
  total: number;
  customerName: string;
}): Promise<void> {
  if (!whatsappEnabled()) return;
  const dest = await loadUserPhone(opts.userId);
  if (!dest) return;

  await enqueueWhatsAppHandoverPack({
    to: dest.to,
    userId: opts.userId,
    orderId: opts.orderId,
    orderNumber: opts.orderNumber,
    total: opts.total,
    customerName: opts.customerName || dest.name,
  });
}

export async function notifyWhatsAppAbandonedCart(opts: {
  userId: string;
  itemCount: number;
  total: number;
}): Promise<void> {
  const dest = await loadUserPhone(opts.userId);
  const tpl = whatsappConfig.templates.abandonedCart;
  if (!dest || !tpl) return;
  await sendTemplate({
    to: dest.to,
    template: tpl,
    bodyParams: [dest.name, String(opts.itemCount), `₹${opts.total.toFixed(0)}`],
    category: "abandoned_cart",
    userId: opts.userId,
  });
}

export async function notifyWhatsAppReviewInvite(opts: {
  userId?: string;
  orderId?: string;
  phone?: string;
  name: string;
  orderNumber: string;
  inviteUrl: string;
}): Promise<boolean> {
  const tpl = whatsappConfig.templates.reviewInvite;
  if (!tpl || !whatsappEnabled()) return false;
  let to = toWhatsAppMsisdn(opts.phone);
  if (!to && opts.userId) {
    const dest = await loadUserPhone(opts.userId);
    to = dest?.to || null;
  }
  if (!to) return false;
  await sendTemplate({
    to,
    template: tpl,
    bodyParams: [opts.name.split(/\s+/)[0] || "there", opts.orderNumber, opts.inviteUrl],
    category: "review_invite",
    userId: opts.userId,
    orderId: opts.orderId,
  });
  return true;
}

export type CatalogAlertKind =
  | "product"
  | "category"
  | "subcategory"
  | "coupon"
  | "promotion"
  | "sale";

const catalogCopy: Record<CatalogAlertKind, (title: string) => string> = {
  product: (t) => `New arrival: ${t}`,
  category: (t) => `New collection: ${t}`,
  subcategory: (t) => `New collection: ${t}`,
  coupon: (t) => `New offer code ${t}`,
  promotion: (t) => `New store offer: ${t}`,
  sale: (t) => `Sale is live: ${t}`,
};

/**
 * Marketing broadcast to opted-in customers with a phone number.
 * Never blocks the admin request — failures are logged only.
 */
export function notifyWhatsAppCatalogAlert(opts: {
  kind: CatalogAlertKind;
  title: string;
  path: string;
}): void {
  if (!whatsappMarketingEnabled()) return;
  const tpl = whatsappConfig.templates.catalog;
  if (!tpl) return;
  const url = `${frontendUrl}${opts.path.startsWith("/") ? opts.path : `/${opts.path}`}`;
  const headline = catalogCopy[opts.kind](opts.title);
  void broadcastCatalogAlert(tpl, headline, url).catch((e: Error) => {
    logger.warn({ msg: "whatsapp_catalog_broadcast_failed", error: e.message });
  });
}

export async function broadcastMarketingWhatsApp(opts: {
  subject: string;
  messagePlain: string;
  ctaLink: string;
  audienceFilter: Record<string, unknown>;
}): Promise<number> {
  if (!whatsappMarketingEnabled()) return 0;
  const tpl = whatsappConfig.templates.catalog;
  if (!tpl) return 0;

  const url = `${frontendUrl}${opts.ctaLink.startsWith("/") ? opts.ctaLink : `/${opts.ctaLink}`}`;
  const headline = `${opts.subject.trim()}: ${opts.messagePlain.slice(0, 120)}`.slice(0, 200);

  const cursor = User.find({
    ...opts.audienceFilter,
    isActive: true,
    whatsappMarketingOptIn: { $ne: false },
    $or: [
      { phone: { $exists: true, $nin: [null, ""] } },
      { "addresses.0.phone": { $exists: true } },
    ],
  })
    .select("name phone addresses.phone")
    .lean<PhoneUser[]>()
    .cursor();

  let sent = 0;
  for await (const user of cursor) {
    const to = resolveUserWhatsApp(user);
    if (!to) continue;
    await enqueueWhatsApp({
      to,
      template: tpl,
      bodyParams: [user.name?.split(/\s+/)[0] || "there", headline, url],
      category: "marketing_campaign",
      userId: String((user as { _id?: unknown })._id || ""),
      campaignSubject: opts.subject,
    });
    sent += 1;
  }
  logger.info({ msg: "whatsapp_marketing_enqueued", sent, subject: opts.subject });
  return sent;
}

async function broadcastCatalogAlert(
  template: string,
  headline: string,
  url: string,
): Promise<number> {
  const cursor = User.find({
    isActive: true,
    role: "user",
    whatsappMarketingOptIn: { $ne: false },
    $or: [{ phone: { $exists: true, $nin: [null, ""] } }, { "addresses.0.phone": { $exists: true } }],
  })
    .select("name phone addresses.phone")
    .lean<PhoneUser[]>()
    .cursor();

  let sent = 0;
  for await (const user of cursor) {
    const to = resolveUserWhatsApp(user);
    if (!to) continue;
    await enqueueWhatsApp({
      to,
      template,
      bodyParams: [user.name?.split(/\s+/)[0] || "there", headline, url],
      category: "catalog_alert",
      userId: String((user as { _id?: unknown })._id || ""),
    });
    sent += 1;
  }
  logger.info({ msg: "whatsapp_catalog_enqueued", sent, headline });
  return sent;
}

export async function countWhatsAppReach(
  audienceFilter: Record<string, unknown>,
): Promise<number> {
  return User.countDocuments({
    ...audienceFilter,
    isActive: true,
    whatsappMarketingOptIn: { $ne: false },
    $or: [
      { phone: { $exists: true, $nin: [null, ""] } },
      { "addresses.0.phone": { $exists: true } },
    ],
  });
}

export async function countUsersWithPhone(
  audienceFilter: Record<string, unknown>,
): Promise<number> {
  return User.countDocuments({
    ...audienceFilter,
    isActive: true,
    $or: [
      { phone: { $exists: true, $nin: [null, ""] } },
      { "addresses.0.phone": { $exists: true } },
    ],
  });
}
