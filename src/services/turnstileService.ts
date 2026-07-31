import logger from "../types/utils/logger";

const VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

/**
 * Cloudflare always-pass test secret (pairs with sitekey 1x00000000000000000000BB / AA).
 * @see https://developers.cloudflare.com/turnstile/troubleshooting/testing/
 */
const TURNSTILE_TEST_SECRET = "1x0000000000000000000000000000000AA";

/** Canonical secret: TURNSTILE_SECRET (Spin). Legacy alias: TURNSTILE_SECRET_KEY. */
export function getTurnstileSecret(): string {
  const configured =
    process.env.TURNSTILE_SECRET?.trim() ||
    process.env.TURNSTILE_SECRET_KEY?.trim() ||
    "";

  // Local/dev: match frontend auto test sitekey on localhost.
  // Set TURNSTILE_USE_PROD_SECRET=true to force the real secret while developing.
  if (
    process.env.NODE_ENV !== "production" &&
    process.env.TURNSTILE_USE_PROD_SECRET !== "true"
  ) {
    return TURNSTILE_TEST_SECRET;
  }

  return configured;
}

/**
 * Enforce when a secret is configured unless explicitly disabled
 * (`TURNSTILE_ENFORCE=false`).
 */
export function turnstileEnabled(): boolean {
  const secret = getTurnstileSecret();
  if (!secret) return false;
  if (process.env.TURNSTILE_ENFORCE === "false") return false;
  return true;
}

export function turnstileOptional(): boolean {
  return Boolean(getTurnstileSecret());
}

/**
 * Canonical Cloudflare siteverify.
 * When enforcement is off, missing token is allowed (gradual rollout).
 */
export async function verifyTurnstileToken(
  token: string | undefined,
  remoteIp?: string,
): Promise<{ ok: boolean; skipped: boolean }> {
  const secret = getTurnstileSecret();
  if (!secret) {
    return { ok: true, skipped: true };
  }

  if (!token?.trim()) {
    if (turnstileEnabled()) {
      return { ok: false, skipped: false };
    }
    return { ok: true, skipped: true };
  }

  try {
    const body = new URLSearchParams({
      secret,
      response: token.trim(),
      ...(remoteIp ? { remoteip: remoteIp } : {}),
    });
    const res = await fetch(VERIFY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    const data = (await res.json()) as {
      success?: boolean;
      "error-codes"?: string[];
      action?: string;
      hostname?: string;
    };
    if (!data.success) {
      logger.warn(
        `Turnstile siteverify rejected: codes=${JSON.stringify(data["error-codes"] || [])} action=${data.action || ""} hostname=${data.hostname || ""}`,
      );
    }
    return { ok: Boolean(data.success), skipped: false };
  } catch (err) {
    logger.warn(`Turnstile verify failed: ${(err as Error).message}`);
    if (turnstileEnabled()) {
      return { ok: false, skipped: false };
    }
    return { ok: true, skipped: true };
  }
}
