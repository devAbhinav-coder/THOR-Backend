import { Request, Response, NextFunction } from "express";
import AppError from "../types/utils/AppError";
import { verifyTurnstileToken } from "../services/turnstileService";
import { authRequestMeta } from "../auth/authNormalize";

/**
 * Optional Cloudflare Turnstile on auth mutations.
 * Body: `turnstileToken` (stripped before handlers run).
 */
export const turnstileGuard = async (
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> => {
  const body = req.body as { turnstileToken?: string };
  const token = body.turnstileToken;
  if (body.turnstileToken !== undefined) {
    delete body.turnstileToken;
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
