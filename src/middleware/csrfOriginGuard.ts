import { Request, Response, NextFunction } from "express";
import AppError from "../utils/AppError";
import logger from "../utils/logger";
import { getCorsAllowedOriginSet, normalizeOriginUrl } from "../config/allowedOrigins";

const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * When browsers send `Origin` on cross-site XHR/fetch, reject if not in the same allowlist as CORS.
 * Mitigates cookie-based CSRF from arbitrary sites; requests without Origin (curl, mobile, SSR) pass.
 */
export function csrfOriginGuard(
  req: Request,
  _res: Response,
  next: NextFunction,
): void {
  if (!MUTATING.has(req.method)) {
    next();
    return;
  }

  const p = req.path || "";
  if (
    p.startsWith("/api/health") ||
    p.startsWith("/api/docs") ||
    p === "/api/docs"
  ) {
    next();
    return;
  }

  const origin = req.get("Origin");
  if (!origin || origin === "null") {
    next();
    return;
  }

  const allowed = getCorsAllowedOriginSet();
  if (!allowed.has(normalizeOriginUrl(origin))) {
    logger.warn(
      `Origin not allowed for ${req.method} ${p}: ${origin} (allowed: ${[...allowed].join(", ")})`,
    );
    next(new AppError("Forbidden", 403));
    return;
  }

  next();
}
