/**
 * Unicode-safe, consistent normalization for auth inputs (applied after Zod parse).
 */

/** NFC normalization + trim for display names and street lines. */
export function normalizeUnicodeText(value: string, maxLen?: number): string {
  const n = value.normalize("NFC").trim().replace(/\s+/g, " ");
  if (maxLen && n.length > maxLen) return n.slice(0, maxLen);
  return n;
}

export function normalizeEmail(email: string): string {
  return email.normalize("NFC").trim().toLowerCase();
}

/** Indian mobile: last 10 digits when valid, else trimmed digits only. */
export function normalizeIndianPhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  const last10 = digits.slice(-10);
  if (/^[6-9]\d{9}$/.test(last10)) return last10;
  return digits;
}

export function normalizeOtp(otp: string): string {
  return otp.replace(/\D/g, "").slice(0, 6);
}

export type AuthRequestMeta = {
  ip: string;
  userAgent: string;
  deviceLabel: string;
  requestId?: string;
  acceptLanguage?: string;
};

export function authRequestMeta(req: {
  ip?: string;
  socket?: { remoteAddress?: string };
  headers?: Record<string, string | string[] | undefined>;
  requestId?: string;
}): AuthRequestMeta {
  const forwarded = req.headers?.["x-forwarded-for"];
  const forwardedIp =
    typeof forwarded === "string" ? forwarded.split(",")[0]?.trim() : undefined;
  const ip =
    forwardedIp ||
    (typeof req.ip === "string" && req.ip) ||
    req.socket?.remoteAddress ||
    "unknown";
  const ua = req.headers?.["user-agent"];
  const userAgent = typeof ua === "string" ? ua.slice(0, 512) : "";
  const acceptLanguage = req.headers?.["accept-language"];
  const lang =
    typeof acceptLanguage === "string" ? acceptLanguage.slice(0, 64) : undefined;
  const requestId =
    typeof req.requestId === "string" && req.requestId ?
      req.requestId
    : typeof req.headers?.["x-request-id"] === "string" ?
      req.headers["x-request-id"].slice(0, 64)
    : undefined;

  return {
    ip,
    userAgent,
    deviceLabel: deviceLabelFromUserAgent(userAgent),
    requestId,
    acceptLanguage: lang,
  };
}

/** Human-readable device label from User-Agent (best-effort). */
export function deviceLabelFromUserAgent(ua: string): string {
  if (!ua) return "Unknown device";
  if (/iPhone|iPad|iPod/i.test(ua)) return /iPad/i.test(ua) ? "iPad" : "iPhone";
  if (/Android/i.test(ua)) return "Android";
  if (/Windows/i.test(ua)) return "Windows";
  if (/Macintosh|Mac OS/i.test(ua)) return "Mac";
  if (/Linux/i.test(ua)) return "Linux";
  return "Web browser";
}
