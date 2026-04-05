import { Resend } from "resend";
import logger from "../utils/logger";
import { htmlToPlainText } from "../utils/emailPlainText";
import { sendViaSmtpWithRetry, smtpConfigured } from "./emailService";

export type DeliverableEmail = {
  to: string;
  subject: string;
  html: string;
  text?: string;
};

let resendClient: Resend | null = null;

function getResend(): Resend | null {
  const key = process.env.RESEND_API_KEY?.trim();
  if (!key) return null;
  if (!resendClient) resendClient = new Resend(key);
  return resendClient;
}

/**
 * "From" for Resend — must be a domain you verified in Resend.
 * Falls back to MAIL_FROM; set RESEND_FROM explicitly if it differs from Zoho.
 */
export function getResendFromAddress(): string {
  const explicit = process.env.RESEND_FROM_EMAIL?.trim();
  if (explicit) return explicit;
  return (
    process.env.MAIL_FROM?.trim() ||
    "The House of Rani <noreply@thehouseofrani.com>"
  );
}

const BROADCAST_RETRIES = 3;
const BROADCAST_BASE_DELAY_MS = 400;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function isRetryableError(msg: string): boolean {
  const m = msg.toLowerCase();
  return (
    m.includes("timeout") ||
    m.includes("etimedout") ||
    m.includes("econnreset") ||
    m.includes("econnrefused") ||
    m.includes("socket") ||
    m.includes("network") ||
    m.includes("429") ||
    m.includes("5")
  );
}

/**
 * Many cloud hosts block outbound SMTP (ports 25 / 587) to stop spam; your laptop does not.
 * Symptom: "Connection timeout" to smtp.zoho.in on the server, works locally. Resend uses HTTPS (443) so it still works.
 *
 * Set OTP_SMTP_ENABLED=0 on that host to skip SMTP for OTP and send via Resend only (no ~40s double-timeout wait).
 */
function isOtpSmtpEnabled(): boolean {
  const v = process.env.OTP_SMTP_ENABLED?.trim().toLowerCase();
  if (v === "0" || v === "false" || v === "no" || v === "off") return false;
  return true;
}

/**
 * Transactional OTP: Zoho (SMTP) first when allowed, then Resend if SMTP fails or is disabled.
 */
export async function deliverOtpEmail(
  payload: DeliverableEmail,
): Promise<void> {
  const text = payload.text || htmlToPlainText(payload.html);

  if (smtpConfigured() && isOtpSmtpEnabled()) {
    try {
      await sendViaSmtpWithRetry(
        {
          to: payload.to,
          subject: payload.subject,
          html: payload.html,
          text,
        },
        2,
      );
      logger.info(`OTP email sent via SMTP to ${payload.to}`);
      return;
    } catch (smtpErr) {
      logger.warn(
        `SMTP OTP delivery failed (${payload.to}): ${(smtpErr as Error).message}; trying Resend`,
      );
    }
  } else if (smtpConfigured() && !isOtpSmtpEnabled()) {
    logger.info(
      `OTP_SMTP_ENABLED off — skipping Zoho for OTP (${payload.to}); using Resend`,
    );
  } else {
    logger.warn("SMTP not configured; sending OTP via Resend only");
  }

  await sendViaResend({ ...payload, text });
  logger.info(`OTP email sent via Resend to ${payload.to}`);
}

/**
 * Marketing / broadcast: Resend only (better API deliverability tooling).
 */
export async function deliverBroadcastEmail(
  payload: DeliverableEmail,
): Promise<void> {
  const text = payload.text || htmlToPlainText(payload.html);
  await sendViaResend({ ...payload, text });
}

export async function sendViaResend(
  payload: DeliverableEmail & { text?: string },
): Promise<void> {
  const client = getResend();
  if (!client) {
    throw new Error("RESEND_API_KEY is not configured.");
  }
  const from = getResendFromAddress();
  const replyTo = process.env.MAIL_REPLY_TO?.trim() || undefined;
  const { data, error } = await client.emails.send({
    from,
    to: payload.to,
    subject: payload.subject,
    html: payload.html,
    text: payload.text || htmlToPlainText(payload.html),
    ...(replyTo ? { replyTo } : {}),
  });
  if (error) {
    throw new Error(error.message || "Resend API error");
  }
  logger.info(`Resend message id ${data?.id ?? "?"} to ${payload.to}`);
}

/**
 * Sequential broadcast send with backoff (used by chunk worker). No parallel sends.
 */
export async function deliverBroadcastEmailWithRetries(
  payload: DeliverableEmail,
): Promise<void> {
  let lastErr: Error | null = null;
  for (let attempt = 1; attempt <= BROADCAST_RETRIES; attempt++) {
    try {
      await deliverBroadcastEmail(payload);
      return;
    } catch (e) {
      lastErr = e as Error;
      logger.warn(
        `Broadcast send attempt ${attempt}/${BROADCAST_RETRIES} failed (${payload.to}): ${lastErr.message}`,
      );
      if (attempt < BROADCAST_RETRIES && isRetryableError(lastErr.message)) {
        await sleep(BROADCAST_BASE_DELAY_MS * attempt * attempt);
      }
    }
  }
  throw lastErr || new Error("Broadcast delivery failed");
}
