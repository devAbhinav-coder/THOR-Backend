import logger from "../types/utils/logger";

const VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

/** Canonical secret: TURNSTILE_SECRET (Spin). Legacy alias: TURNSTILE_SECRET_KEY. */
export function getTurnstileSecret(): string {
  return (
    process.env.TURNSTILE_SECRET?.trim() ||
    process.env.TURNSTILE_SECRET_KEY?.trim() ||
    ""
  );
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
    const data = (await res.json()) as { success?: boolean };
    return { ok: Boolean(data.success), skipped: false };
  } catch (err) {
    logger.warn(`Turnstile verify failed: ${(err as Error).message}`);
    if (turnstileEnabled()) {
      return { ok: false, skipped: false };
    }
    return { ok: true, skipped: true };
  }
}
