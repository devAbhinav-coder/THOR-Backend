import crypto from "crypto";
import fs from "fs";
import path from "path";
import nodemailer from "nodemailer";
import logger from "../utils/logger";
import { htmlToPlainText } from "../utils/emailPlainText";

type EmailPayload = {
  to: string;
  subject: string;
  html: string;
  text?: string;
};

const fromEmail =
  process.env.MAIL_FROM || "The House of Rani <no-reply@houseofrani.in>";
const replyToEmail = process.env.MAIL_REPLY_TO || "support@thehouseofrani.com";
const frontendUrl = process.env.FRONTEND_URL || "https://thehouseofrani.com";
const isLocalhost = frontendUrl.includes("localhost");
const brandLogoUrl = isLocalhost ? "cid:brandlogo" : `${frontendUrl}/logo.png`;

function getLocalLogoPath() {
  const p = path.resolve(__dirname, "../../../../frontend/public/logo.png");
  return fs.existsSync(p) ? p : null;
}

function extractMailDomain(fromHeader: string): string {
  const m = fromHeader.match(/<([^>]+)>/);
  const addr = (m ? m[1] : fromHeader).trim();
  const at = addr.lastIndexOf("@");
  return at >= 0 ? addr.slice(at + 1).toLowerCase() : "localhost";
}

function buildDkim():
  | { domainName: string; keySelector: string; privateKey: string }
  | undefined {
  const domainName = process.env.DKIM_DOMAIN?.trim();
  if (!domainName) return undefined;

  const keySelector = process.env.DKIM_SELECTOR?.trim() || "default";
  const keyPath = process.env.DKIM_PRIVATE_KEY_PATH?.trim();
  const keyInline = process.env.DKIM_PRIVATE_KEY?.replace(/\\n/g, "\n").trim();

  try {
    let privateKey: string;
    if (keyInline) {
      privateKey = keyInline;
    } else if (keyPath) {
      privateKey = fs.readFileSync(path.resolve(keyPath), "utf8");
    } else {
      return undefined;
    }
    if (!privateKey.includes("BEGIN") || !privateKey.includes("KEY")) {
      logger.warn(
        "DKIM_PRIVATE_KEY(_PATH) does not look like a PEM key; DKIM disabled.",
      );
      return undefined;
    }
    return { domainName, keySelector, privateKey };
  } catch (e) {
    logger.warn(`DKIM could not be loaded: ${(e as Error).message}`);
    return undefined;
  }
}

const smtpPort = Number(process.env.SMTP_PORT || 587);
const smtpSecure = process.env.SMTP_SECURE === "true";
const dkimOpts = buildDkim();

const connectionTimeoutMs = parseInt(process.env.SMTP_CONNECTION_TIMEOUT_MS || "20000", 10);
const socketTimeoutMs = parseInt(process.env.SMTP_SOCKET_TIMEOUT_MS || "25000", 10);
const greetingTimeoutMs = parseInt(process.env.SMTP_GREETING_TIMEOUT_MS || "15000", 10);

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: smtpPort,
  secure: smtpSecure,
  connectionTimeout: connectionTimeoutMs,
  socketTimeout: socketTimeoutMs,
  greetingTimeout: greetingTimeoutMs,
  ...(!smtpSecure && process.env.SMTP_REQUIRE_TLS !== "false" ?
    { requireTLS: true }
  : {}),
  auth:
    process.env.SMTP_USER ?
      {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      }
    : undefined,
  ...(dkimOpts ? { dkim: dkimOpts } : {}),
  tls: {
    minVersion: "TLSv1.2" as const,
    rejectUnauthorized: process.env.SMTP_TLS_REJECT_UNAUTHORIZED !== "false",
  },
});

export function smtpConfigured(): boolean {
  return Boolean(process.env.SMTP_HOST?.trim());
}

type SmtpPayload = {
  to: string;
  subject: string;
  html: string;
  text?: string;
};

/**
 * SMTP send with limited retries (timeouts / transient socket errors).
 */
export async function sendViaSmtpWithRetry(
  payload: SmtpPayload,
  maxAttempts = 2,
): Promise<void> {
  if (!smtpConfigured()) {
    throw new Error("SMTP is not configured (SMTP_HOST missing).");
  }

  const mailOptions: import("nodemailer/lib/mailer").Options = {
    from: fromEmail,
    replyTo: replyToEmail,
    to: payload.to,
    subject: payload.subject,
    html: payload.html,
    text: payload.text || htmlToPlainText(payload.html),
  };

  if (isLocalhost) {
    const p = getLocalLogoPath();
    if (p) {
      mailOptions.attachments = [
        {
          filename: "logo.jpg",
          path: p,
          cid: "brandlogo",
        },
      ];
    }
  }

  let lastErr: Error | null = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const info = await transporter.sendMail(mailOptions);
      logger.info(`Email sent (SMTP): ${info.messageId} to ${payload.to}`);
      return;
    } catch (e) {
      lastErr = e as Error;
      logger.warn(
        `SMTP attempt ${attempt}/${maxAttempts} failed (${payload.to}): ${lastErr.message}`,
      );
      if (attempt < maxAttempts) {
        await new Promise((r) => setTimeout(r, 800 * attempt));
      }
    }
  }
  throw lastErr || new Error("SMTP send failed");
}

const shell = (
  title: string,
  body: string,
  ctaText?: string,
  ctaLink?: string,
) => `
  <div style="font-family:Inter,Segoe UI,Arial,sans-serif;background:#f3f4f6;padding:28px;">
    <div style="max-width:680px;margin:0 auto;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #e5e7eb;box-shadow:0 10px 30px rgba(15,23,42,0.08);">
      <div style="padding:20px 24px; background:linear-gradient(135deg,#0f172a,#1f2937);color:#fff;">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
          <tr>
            <td style="vertical-align:middle;">
              <img src="${brandLogoUrl}" alt="The House of Rani" width="140" height="42" style="height:42px;width:auto;max-width:140px;display:block;border:0;" />
            </td>
            <td style="text-align:right;vertical-align:middle;">
              <span style="display:inline-block;background:rgba(255,255,255,0.14);padding:6px 10px;border-radius:999px;font-size:11px;letter-spacing:.06em;">
                The House of Rani
              </span>
            </td>
          </tr>
        </table>
      </div>
      <div style="padding:28px 24px 22px;">
        <p style="margin:0 0 8px;font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#9ca3af;">Account notification</p>
        <h2 style="margin:0 0 12px;font-size:24px;line-height:1.3;color:#111827;">${title}</h2>
        <div style="font-size:15px;line-height:1.8;color:#374151;">${body}</div>
        ${
          ctaText && ctaLink ?
            `
            <div style="margin-top:20px;">
              <a href="${ctaLink}" style="display:inline-block;background:#e8604c;color:#fff;text-decoration:none;padding:12px 18px;border-radius:10px;font-size:14px;font-weight:600;">
                ${ctaText}
              </a>
            </div>
            <p style="margin:12px 0 0;font-size:12px;color:#6b7280;">
              If the button does not work, open this link in your browser:<br/>
              <a href="${ctaLink}" style="color:#4f46e5;word-break:break-all;">${ctaLink}</a>
            </p>
          `
          : ""
        }
      </div>
      <div style="padding:16px 24px;border-top:1px solid #e5e7eb;background:#fafafa;">
        <p style="margin:0;font-size:12px;color:#6b7280;">
          This is an automated message. For help, use the contact options on our website.
        </p>
        <p style="margin:8px 0 0;font-size:12px;color:#9ca3af;">
          © ${new Date().getFullYear()} The House of Rani
        </p>
      </div>
    </div>
  </div>
`;

export const emailTemplates = {
  welcome: (name: string) => ({
    subject: "Welcome to The House of Rani",
    html: shell(
      `Welcome, ${name}`,
      "Your account is ready. You can sign in anytime to browse new arrivals and track your orders.",
      "Shop collection",
      `${frontendUrl}/shop`,
    ),
  }),
  couponAnnouncement: (code: string, description?: string) => ({
    subject: `Offer: ${code} — The House of Rani`,
    html: shell(
      "Promotional offer",
      `You can use code <b>${code}</b>${description ? ` — ${description}` : ""} on your next qualifying order at checkout.`,
      "Visit store",
      `${frontendUrl}/shop`,
    ),
  }),
  orderPlacedUser: (name: string, orderNumber: string, total: number) => ({
    subject: `Order confirmation ${orderNumber}`,
    html: shell(
      "Thank you for your order",
      `Hi ${name},<br/><br/>We have received order <b>${orderNumber}</b>.<br/>Order total: <b>₹${total.toFixed(2)}</b>.`,
      "View order",
      `${frontendUrl}/dashboard/orders`,
    ),
  }),
  orderStatusUpdate: (name: string, orderNumber: string, status: string, opts?: { carrier?: string; awb?: string; trackingUrl?: string }) => ({
    subject: `Order ${orderNumber} — ${status}`,
    html: shell(
      status === 'shipped' ? '📦 Your order is on the way!' :
      status === 'delivered' ? '✅ Order Delivered!' :
      status === 'cancelled' ? '❌ Order Cancelled' : 'Order update',
      `Hi ${name},<br/><br/>Your order <b>${orderNumber}</b> is now <b>${status}</b>.<br/><br/>
       ${status === 'shipped' && opts?.carrier ? `<b>Courier:</b> ${opts.carrier}<br/>${opts.awb ? `<b>AWB:</b> ${opts.awb}<br/>` : ''}${opts?.trackingUrl ? `<b><a href="${opts.trackingUrl}" style="color:#b45309;">Track your shipment →</a></b><br/>` : ''}<br/>` : ''}
       ${status === 'delivered' ? 'We hope you love your purchase! If you have any issues, please reach out within 7 days.' : ''}
       ${status === 'cancelled' ? 'If you did not request this, please contact our support team immediately.' : ''}`,
      'View order',
      `${frontendUrl}/dashboard/orders`,
    ),
  }),
  userOrderCancelled: (name: string, orderNumber: string, reason?: string, initiatedBy: 'customer' | 'admin' = 'customer') => ({
    subject: `Order ${orderNumber} has been cancelled`,
    html: shell(
      '❌ Order Cancelled',
      `Hi ${name},<br/><br/>
       ${initiatedBy === 'admin'
         ? `Your order <b>${orderNumber}</b> has been <b>cancelled</b> by our team.`
         : `Your cancellation request for order <b>${orderNumber}</b> has been confirmed.`
       }<br/><br/>
       ${reason ? `<b>Reason:</b> ${reason}<br/><br/>` : ''}
       If you paid online, your refund will be processed to the original payment method within <b>5–7 business days</b>.<br/><br/>
       We're sorry for the inconvenience. Feel free to place a new order anytime.`,
      'Shop now',
      `${frontendUrl}/shop`,
    ),
  }),
  adminNewOrder: (
    orderNumber: string,
    total: number,
    customerName: string,
    customerEmail: string,
  ) => ({
    subject: `New order ${orderNumber}`,
    html: shell(
      "New order",
      `Order: <b>${orderNumber}</b><br/>Customer: <b>${customerName}</b> (${customerEmail})<br/>Total: <b>₹${total.toFixed(2)}</b>.`,
      "Admin orders",
      `${frontendUrl}/admin/orders`,
    ),
  }),
  custom: (
    subject: string,
    html: string,
    ctaText?: string,
    ctaLink?: string,
  ) => ({
    subject,
    html: shell(subject, html, ctaText, ctaLink),
  }),
  customGiftQuote: (
    name: string,
    occasion: string,
    price: number,
    deliveryTime: string,
    adminNote?: string,
    requestId?: string,
  ) => ({
    subject: `Quote ready for your custom gift: ${occasion}`,
    html: shell(
      "Custom gift quote",
      `Hi ${name},<br/><br/>Your custom gift request for "${occasion}" has been reviewed by our team.<br/><br/>
       Price: <b>₹${price.toFixed(2)}</b><br/>
       Estimated Delivery: <b>${deliveryTime}</b><br/>
       ${adminNote ? `Note from admin: ${adminNote}<br/>` : ""}<br/>
       Please review the quote and choose to accept or reject it to proceed.`,
      "Review Quote",
      `${frontendUrl}/dashboard/gifting/${requestId}`,
    ),
  }),
  adminNewGiftingRequest: (
    requesterName: string,
    requesterEmail: string,
    requesterPhone: string | undefined,
    occasion: string,
    itemCount: number,
    proposedPrice: number | undefined,
    requestId: string,
  ) => ({
    subject: `New Custom Gift Request — ${occasion}`,
    html: shell(
      "New Custom Gift Request",
      `A new customization request has come in and requires your attention.<br/><br/>
       <b>From:</b> ${requesterName} (${requesterEmail})${requesterPhone ? `<br/><b>Phone:</b> ${requesterPhone}` : ""}<br/>
       <b>Occasion:</b> ${occasion}<br/>
       <b>Items:</b> ${itemCount}<br/>
       ${proposedPrice ? `<b>Proposed Budget:</b> ₹${proposedPrice.toFixed(2)}<br/>` : ""}
       <br/>Please review and send a quote as soon as possible.`,
      "Review Request",
      `${frontendUrl}/admin/gifting`,
    ),
  }),
  customGiftOrderCreated: (
    userName: string,
    occasion: string,
    orderNumber: string,
    quotedPrice: number,
    orderId: string,
  ) => ({
    subject: `Your Custom Gift Order is Created — ${orderNumber}`,
    html: shell(
      "Order Created 🎁",
      `Hi ${userName},<br/><br/>
       Your custom gift order has been created! We're excited to create something special for you.<br/><br/>
       <b>Occasion:</b> ${occasion}<br/>
       <b>Order Number:</b> ${orderNumber}<br/>
       <b>Order Total:</b> <b>₹${quotedPrice.toFixed(2)}</b><br/><br/>
       Our team will reach out to you shortly to arrange payment and discuss production details.
       You can track your order status anytime from your dashboard.`,
      "View My Order",
      `${frontendUrl}/dashboard/orders/${orderId}`,
    ),
  }),
  adminCustomGiftAccepted: (
    requesterName: string,
    occasion: string,
    orderNumber: string,
    quotedPrice: number,
    orderId: string,
  ) => ({
    subject: `Custom Gift Accepted — Order ${orderNumber}`,
    html: shell(
      "Customer Accepted the Quote ✅",
      `<b>${requesterName}</b> has accepted the quote for their <b>${occasion}</b> custom gift request.<br/><br/>
       Order Number: <b>${orderNumber}</b><br/>
       Quoted Price: <b>₹${quotedPrice.toFixed(2)}</b><br/><br/>
       Please contact the customer to arrange payment and begin production.`,
      "View Order",
      `${frontendUrl}/admin/orders/${orderId}`,
    ),
  }),
  adminCustomGiftRejected: (
    requesterName: string,
    occasion: string,
    requestId: string,
  ) => ({
    subject: `Custom Gift Rejected — ${occasion}`,
    html: shell(
      "Customer Rejected the Quote ❌",
      `<b>${requesterName}</b> has rejected the quote for their <b>${occasion}</b> custom gift request.<br/><br/>
       The request has been closed. You may wish to follow up with the customer directly if needed.`,
      "View Request",
      `${frontendUrl}/admin/gifting`,
    ),
  }),

  // ─── Return / Refund emails ───────────────────────────────────────────────

  userReturnRequested: (name: string, orderNumber: string, reason: string, refundMethod: string) => ({
    subject: `Return request received — ${orderNumber}`,
    html: shell(
      "Return Request Received",
      `Hi ${name},<br/><br/>We have received your return request for order <b>${orderNumber}</b>.<br/><br/>
       <b>Reason:</b> ${reason}<br/>
       <b>Refund Method:</b> ${refundMethod.replace(/_/g, ' ')}<br/><br/>
       Our team will review your request within 1-2 business days and update you on the status.
       If your return is approved, you'll receive your refund within 5-7 working days.`,
      "View Order",
      `${frontendUrl}/dashboard/orders`,
    ),
  }),

  userReturnStatusUpdated: (name: string, orderNumber: string, status: 'approved' | 'rejected', adminNote?: string) => ({
    subject: `Return ${status} — ${orderNumber}`,
    html: shell(
      status === 'approved' ? "Return Approved ✅" : "Return Rejected ❌",
      `Hi ${name},<br/><br/>Your return request for order <b>${orderNumber}</b> has been <b>${status}</b>.<br/><br/>
       ${adminNote ? `<b>Note from our team:</b> ${adminNote}<br/><br/>` : ''}
       ${status === 'approved'
         ? 'Your refund will be processed shortly. You will receive a confirmation once the refund is completed (5–7 working days).'
         : 'Unfortunately your return request was not approved. Please reach out to our support team if you have questions.'}`,
      "View Order",
      `${frontendUrl}/dashboard/orders`,
    ),
  }),

  userRefundProcessed: (
    name: string,
    orderNumber: string,
    amount: number,
    method: string,
    refundDetails?: {
      upiId?: string;
      accountName?: string;
      accountNumber?: string;
      bankName?: string;
    },
  ) => ({
    subject: `Refund processed — ${orderNumber}`,
    html: shell(
      '💸 Refund Processed',
      `Hi ${name},<br/><br/>Your refund for order <b>${orderNumber}</b> has been processed.<br/><br/>
       <b>Amount:</b> ₹${amount.toFixed(2)}<br/>
       <b>Method:</b> ${method.replace(/_/g, ' ')}<br/><br/>
       ${method === 'razorpay_auto' || method === 'original_payment'
         ? '✅ The refund has been initiated to your <b>original payment method</b> (card/UPI/net banking).<br/>It will reflect in <b>5–7 business days</b> depending on your bank.'
         : method === 'upi_manual' || method === 'upi'
           ? `✅ The refund will be transferred to your UPI ID: <b>${refundDetails?.upiId || 'your registered UPI ID'}</b>.<br/>It typically arrives within <b>1–2 business days</b>.`
           : method === 'bank_transfer'
             ? `✅ The refund will be transferred to your bank account:<br/>
                <b>Account Name:</b> ${refundDetails?.accountName || '—'}<br/>
                <b>Account Number:</b> ****${(refundDetails?.accountNumber || '').slice(-4) || '—'}<br/>
                <b>Bank:</b> ${refundDetails?.bankName || '—'}<br/>
                Transfers typically arrive within <b>2–3 business days</b>.`
             : method === 'cash'
               ? '✅ A cash refund will be arranged by our team. We will contact you to coordinate the handover.'
               : 'Please allow 5–7 business days for the refund to reflect.'
       }`,
      'View Order',
      `${frontendUrl}/dashboard/orders`,
    ),
  }),

  adminNewReturnRequest: (
    customerName: string,
    customerEmail: string,
    orderNumber: string,
    orderId: string,
    reason: string,
    refundMethod: string,
    paymentMethod: string,
  ) => ({
    subject: `🔄 Return Request — ${orderNumber}`,
    html: shell(
      'New Return Request',
      `A customer has requested a return for their order.<br/><br/>
       <b>Customer:</b> ${customerName} (${customerEmail})<br/>
       <b>Order:</b> ${orderNumber}<br/>
       <b>Payment Method:</b> ${paymentMethod}<br/>
       <b>Reason:</b> ${reason}<br/>
       <b>Requested Refund Via:</b> ${refundMethod.replace(/_/g, ' ')}<br/><br/>
       Please review and take action within 48 hours.`,
      'Review Return',
      `${frontendUrl}/admin/orders/${orderId}`,
    ),
  }),
  adminReturnResolved: (
    customerName: string,
    orderNumber: string,
    orderId: string,
    action: 'approved' | 'rejected',
    adminNote?: string,
  ) => ({
    subject: `Return ${action} — ${orderNumber}`,
    html: shell(
      action === 'approved' ? '✅ Return Approved' : '❌ Return Rejected',
      `You have <b>${action}</b> the return request for order <b>${orderNumber}</b> by <b>${customerName}</b>.<br/><br/>
       ${adminNote ? `<b>Admin Note:</b> ${adminNote}<br/><br/>` : ''}
       ${action === 'approved' ? 'The customer has been notified and is expecting their refund to be processed.' : 'The customer has been notified of the rejection.'}`,
      'View Order',
      `${frontendUrl}/admin/orders/${orderId}`,
    ),
  }),
  adminOrderCancelled: (
    customerName: string,
    customerEmail: string,
    orderNumber: string,
    orderId: string,
    reason?: string,
    initiatedBy: 'customer' | 'admin' = 'customer',
  ) => ({
    subject: `🚨 Order Cancelled — ${orderNumber}`,
    html: shell(
      'Order Cancelled',
      `Order <b>${orderNumber}</b> has been cancelled${initiatedBy === 'customer' ? ' by the customer' : ' by an admin'}.<br/><br/>
       <b>Customer:</b> ${customerName} (${customerEmail})<br/>
       ${reason ? `<b>Reason:</b> ${reason}<br/>` : ''}<br/>
       If this order was paid, please ensure a refund is processed if applicable.`,
      'View Order',
      `${frontendUrl}/admin/orders/${orderId}`,
    ),
  }),
  adminRefundProcessed: (
    customerName: string,
    customerEmail: string,
    orderNumber: string,
    orderId: string,
    amount: number,
    method: string,
  ) => ({
    subject: `💸 Refund Processed — ${orderNumber}`,
    html: shell(
      'Refund Processed',
      `A refund has been successfully processed for order <b>${orderNumber}</b>.<br/><br/>
       <b>Customer:</b> ${customerName} (${customerEmail})<br/>
       <b>Amount:</b> ₹${amount.toFixed(2)}<br/>
       <b>Method:</b> ${method.replace(/_/g, ' ')}<br/><br/>
       This is for your records. The customer has been notified separately.`,
      'View Order',
      `${frontendUrl}/admin/orders/${orderId}`,
    ),
  }),

  otpSignup: (name: string, code: string) => ({
    subject: "Your verification code",
    html: shell(
      "Verify your email",
      `Hi ${name},<br/><br/>Your verification code is:<br/><br/><b style="font-size:22px;letter-spacing:0.18em;color:#0f172a;">${code}</b><br/><br/>It expires in <b>10 minutes</b>. If you did not request this, you can ignore this email.`,
    ),
  }),
  otpPasswordReset: (name: string, code: string) => ({
    subject: "Password reset code",
    html: shell(
      "Reset your password",
      `Hi ${name},<br/><br/>Use this code to reset your password:<br/><br/><b style="font-size:22px;letter-spacing:0.18em;color:#0f172a;">${code}</b><br/><br/>It expires in <b>10 minutes</b>. If you did not request a reset, ignore this email.`,
    ),
  }),
  /** Email OTP sign-in (passwordless) for verified non-Google accounts. */
  otpLogin: (name: string, code: string) => ({
    subject: "Your sign-in code",
    html: shell(
      "Sign in to your account",
      `Hi ${name},<br/><br/>Your one-time sign-in code is:<br/><br/><b style="font-size:22px;letter-spacing:0.18em;color:#0f172a;">${code}</b><br/><br/>It expires in <b>10 minutes</b>. If you did not try to sign in, ignore this email.`,
    ),
  }),
};

export const sendEmailNow = async (payload: EmailPayload) => {
  if (!smtpConfigured()) {
    logger.warn(`SMTP_HOST missing, skipping email to ${payload.to}`);
    return;
  }

  await sendViaSmtpWithRetry(
    {
      to: payload.to,
      subject: payload.subject,
      html: payload.html,
      text: payload.text,
    },
    2,
  );
};
