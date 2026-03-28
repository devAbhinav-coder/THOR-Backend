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
const replyToEmail = process.env.MAIL_REPLY_TO || "no-reply@houseofrani.in";
const frontendUrl = process.env.FRONTEND_URL || "http://localhost:3000";
const brandLogo = `${frontendUrl}/logo.jpg`;

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
      logger.warn("DKIM_PRIVATE_KEY(_PATH) does not look like a PEM key; DKIM disabled.");
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

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: smtpPort,
  secure: smtpSecure,
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
              <img src="${brandLogo}" alt="The House of Rani" width="140" height="42" style="height:42px;width:auto;max-width:140px;display:block;border:0;" />
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
  orderStatusUpdate: (name: string, orderNumber: string, status: string) => ({
    subject: `Order ${orderNumber} — ${status}`,
    html: shell(
      "Order update",
      `Hi ${name},<br/><br/>Your order <b>${orderNumber}</b> is now <b>${status}</b>.`,
      "View order",
      `${frontendUrl}/dashboard/orders`,
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
};

export const sendEmailNow = async (payload: EmailPayload): Promise<void> => {
  if (!process.env.SMTP_HOST) {
    logger.warn(`SMTP_HOST missing, skipping email to ${payload.to}`);
    return;
  }

  const domain = extractMailDomain(fromEmail);
  const messageId = `<${crypto.randomBytes(12).toString("hex")}.${Date.now()}@${domain}>`;
  const text = (payload.text && payload.text.trim()) || htmlToPlainText(payload.html);

  await transporter.sendMail({
    from: fromEmail,
    replyTo: replyToEmail,
    to: payload.to,
    subject: payload.subject.replace(/\s+/g, " ").trim(),
    text,
    html: payload.html,
    messageId,
  });
};
