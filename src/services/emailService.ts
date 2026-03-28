import nodemailer from "nodemailer";
import logger from "../utils/logger";

type EmailPayload = {
  to: string;
  subject: string;
  html: string;
  text?: string;
};

const fromEmail =
  process.env.MAIL_FROM || "The House of Rani <no-reply@houseofrani.in>";
const replyToEmail = process.env.MAIL_REPLY_TO || "no-reply@houseofrani.in";
const frontendUrl = process.env.FRONTEND_URL || "http://localhost:3000";
const brandLogo = `${frontendUrl}/logo.jpg`;

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT || 587),
  secure: process.env.SMTP_SECURE === "true",
  auth:
    process.env.SMTP_USER ?
      {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      }
    : undefined,
});

const shell = (
  title: string,
  body: string,
  ctaText?: string,
  ctaLink?: string,
) => `
  <div style="font-family:Inter,Segoe UI,Arial,sans-serif;background:#f3f4f6;padding:28px;">
    <div style="max-width:680px;margin:0 auto;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #e5e7eb;box-shadow:0 10px 30px rgba(15,23,42,0.08);">
      <div style="padding:20px 24px;background:linear-gradient(135deg,#0f172a,#1f2937);color:#fff;">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
          <tr>
            <td style="vertical-align:middle;">
              <img src="${brandLogo}" alt="The House of Rani" style="height:42px;width:auto;display:block;" />
            </td>
            <td style="text-align:right;vertical-align:middle;">
              <span style="display:inline-block;background:rgba(255,255,255,0.14);padding:6px 10px;border-radius:999px;font-size:11px;letter-spacing:.08em;text-transform:uppercase;">
                Premium Ethnic Wear
              </span>
            </td>
          </tr>
        </table>
      </div>
      <div style="padding:28px 24px 22px;">
        <p style="margin:0 0 8px;font-size:11px;letter-spacing:.09em;text-transform:uppercase;color:#9ca3af;">The House of Rani</p>
        <h2 style="margin:0 0 12px;font-size:24px;line-height:1.3;color:#111827;">${title}</h2>
        <div style="font-size:15px;line-height:1.8;color:#374151;">${body}</div>
        <div style="margin-top:16px;padding:12px 14px;background:#f8fafc;border:1px solid #e5e7eb;border-radius:12px;">
          <p style="margin:0;font-size:12px;color:#475569;">
            Curated styles, premium fabrics, reliable delivery - built for a modern shopping experience.
          </p>
        </div>
        ${
          ctaText && ctaLink ?
            `
            <div style="margin-top:20px;">
              <a href="${ctaLink}" style="display:inline-block;background:#e8604c;color:#fff;text-decoration:none;padding:12px 18px;border-radius:10px;font-size:14px;font-weight:700;letter-spacing:.01em;">
                ${ctaText}
              </a>
            </div>
            <p style="margin:10px 0 0;font-size:12px;color:#9ca3af;">
              Button not working? Copy this link: <a href="${ctaLink}" style="color:#6366f1;text-decoration:none;">${ctaLink}</a>
            </p>
          `
          : ""
        }
      </div>
      <div style="padding:16px 24px;border-top:1px solid #e5e7eb;background:#fafafa;">
        <p style="margin:0;font-size:12px;color:#6b7280;">
          This mailbox is not monitored. Please do not reply to this email.
        </p>
        <p style="margin:6px 0 0;font-size:12px;color:#9ca3af;">
          © ${new Date().getFullYear()} The House of Rani. All rights reserved.
        </p>
      </div>
    </div>
  </div>
`;

export const emailTemplates = {
  welcome: (name: string) => ({
    subject: "Welcome to The House of Rani",
    html: shell(
      `Welcome, ${name}!`,
      "Your account is ready. Explore our latest sarees, lehengas and festive edits curated just for you.",
      "Start Shopping",
      `${frontendUrl}/shop`,
    ),
  }),
  couponAnnouncement: (code: string, description?: string) => ({
    subject: `New Offer: ${code}`,
    html: shell(
      "A new offer is live",
      `Use coupon <b>${code}</b>${description ? ` - ${description}` : ""} on your next order.`,
      "Shop & Apply Coupon",
      `${frontendUrl}/shop`,
    ),
  }),
  orderPlacedUser: (name: string, orderNumber: string, total: number) => ({
    subject: `Order placed successfully (${orderNumber})`,
    html: shell(
      "Your order is confirmed",
      `Hi ${name}, your order <b>${orderNumber}</b> has been placed successfully.<br/>Order total: <b>₹${total.toFixed(2)}</b>.`,
      "View Order",
      `${frontendUrl}/dashboard/orders`,
    ),
  }),
  orderStatusUpdate: (name: string, orderNumber: string, status: string) => ({
    subject: `Order ${orderNumber} is now ${status}`,
    html: shell(
      "Order status updated",
      `Hi ${name}, your order <b>${orderNumber}</b> status is now <b>${status}</b>.`,
      "Track Order",
      `${frontendUrl}/dashboard/orders`,
    ),
  }),
  adminNewOrder: (
    orderNumber: string,
    total: number,
    customerName: string,
    customerEmail: string,
  ) => ({
    subject: `New order received (${orderNumber})`,
    html: shell(
      "A new order has arrived",
      `Order: <b>${orderNumber}</b><br/>Customer: <b>${customerName}</b> (${customerEmail})<br/>Total: <b>₹${total.toFixed(2)}</b>.`,
      "Open Admin Orders",
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
  otpSignup: (name: string, code: string) => ({
    subject: "Your verification code — The House of Rani",
    html: shell(
      "Verify your email",
      `Hi ${name},<br/><br/>Your one-time verification code is:<br/><br/><b style="font-size:22px;letter-spacing:0.2em;color:#0f172a;">${code}</b><br/><br/>This code expires in <b>10 minutes</b>. If you didn&apos;t request this, you can ignore this email.`,
    ),
  }),
  otpPasswordReset: (name: string, code: string) => ({
    subject: "Reset your password — The House of Rani",
    html: shell(
      "Password reset code",
      `Hi ${name},<br/><br/>Use this code to reset your password:<br/><br/><b style="font-size:22px;letter-spacing:0.2em;color:#0f172a;">${code}</b><br/><br/>This code expires in <b>10 minutes</b>. If you didn&apos;t request a reset, ignore this email.`,
    ),
  }),
};

export const sendEmailNow = async (payload: EmailPayload): Promise<void> => {
  if (!process.env.SMTP_HOST) {
    logger.warn(`SMTP_HOST missing, skipping email to ${payload.to}`);
    return;
  }
  await transporter.sendMail({
    from: fromEmail,
    replyTo: replyToEmail,
    to: payload.to,
    subject: payload.subject,
    html: payload.html,
    text: payload.text,
  });
};
