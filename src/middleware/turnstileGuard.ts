import { timingSafeEqual } from "crypto";
import { Request, Response, NextFunction } from "express";
import AppError from "../types/utils/AppError";
import { verifyTurnstileToken } from "../services/turnstileService";
import { authRequestMeta } from "../auth/authNormalize";

type TurnstileBody = {
  turnstileToken?: string;
  "cf-turnstile-response"?: string;
};

function isMobileClient(req: Request): boolean {
  const origin = req.get("Origin");
  if (origin) return false;
  const client = String(
    req.headers["x-client"] || req.headers["x-client-type"] || "",
  )
    .trim()
    .toLowerCase();
  return client === "mobile" || client === "app" || client === "expo";
}

function mobileAppKeyValid(req: Request): boolean {
  const expected = process.env.MOBILE_APP_API_KEY?.trim();
  if (!expected) return false;
  const provided = String(req.headers["x-app-key"] || "").trim();
  if (!provided || provided.length !== expected.length) return false;
  try {
    return timingSafeEqual(Buffer.from(provided), Buffer.from(expected));
  } catch {
    return false;
  }
}

/** Whether Turnstile can be skipped for this request (native app with shared secret only). */
function canSkipTurnstile(req: Request): boolean {
  if (!isMobileClient(req)) return false;

  if (process.env.NODE_ENV !== "production") {
    return process.env.TURNSTILE_MOBILE_SKIP_DEV === "true";
  }

  return mobileAppKeyValid(req);
}

/**
 * Cloudflare Turnstile on auth mutations.
 * Accepts `turnstileToken` or canonical `cf-turnstile-response`; strips both
 * before handlers run. Native mobile skips only with valid X-App-Key in production.
 */
export const turnstileGuard = async (
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> => {
  if (canSkipTurnstile(req)) {
    return next();
  }

  const body = req.body as TurnstileBody;
  const token =
    (typeof body.turnstileToken === "string" ? body.turnstileToken : undefined) ||
    (typeof body["cf-turnstile-response"] === "string"
      ? body["cf-turnstile-response"]
      : undefined);

  if (body.turnstileToken !== undefined) {
    delete body.turnstileToken;
  }
  if (body["cf-turnstile-response"] !== undefined) {
    delete body["cf-turnstile-response"];
  }

  const { ip } = authRequestMeta(req);
  const result = await verifyTurnstileToken(token, ip);
  if (!result.ok) {
    return next(
      new AppError("Security verification failed. Please try again.", 403),
    );
  }
  next();
};
