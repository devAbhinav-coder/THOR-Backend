import logger from "../types/utils/logger";

const VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

export function turnstileEnabled(): boolean {
  return Boolean(
    process.env.TURNSTILE_SECRET_KEY?.trim() &&
    process.env.TURNSTILE_ENFORCE === "true",
  );
}

export function turnstileOptional(): boolean {
  return Boolean(process.env.TURNSTILE_SECRET_KEY?.trim());
}

/**
 * Verifies Cloudflare Turnstile token when secret is configured.
 * When TURNSTILE_ENFORCE is not true, missing token is allowed (hook for gradual rollout).
 */
export async function verifyTurnstileToken(
  token: string | undefined,
  remoteIp?: string,
): Promise<{ ok: boolean; skipped: boolean }> {
  const secret = process.env.TURNSTILE_SECRET_KEY?.trim();
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
