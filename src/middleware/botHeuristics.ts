import { Request, Response, NextFunction } from "express";
import { securityLog } from "../utils/securityLog";
import AppError from "../utils/AppError";

const SUSPICIOUS_UA = [
  "sqlmap",
  "nikto",
  "acunetix",
  "masscan",
  "nmap",
  "wpscan",
  "nessus",
  "openvas",
  "arachni",
  "dirbuster",
  "gobuster",
];

function isSuspiciousUserAgent(ua: string | undefined): boolean {
  if (!ua || !ua.trim()) {
    return true;
  }
  const lower = ua.toLowerCase();
  return SUSPICIOUS_UA.some((s) => lower.includes(s));
}

/**
 * Light application-layer bot / scanner filtering. Pair with nginx rate limits and a WAF at the edge.
 */
export const botHeuristics = (req: Request, _res: Response, next: NextFunction): void => {
  if (req.method === "OPTIONS") {
    return next();
  }
  const path = req.path || req.url || "";
  if (path.endsWith("/health") || path.includes("/api/health")) {
    return next();
  }

  const mutating = ["POST", "PUT", "PATCH", "DELETE"].includes(req.method);
  if (!mutating) {
    return next();
  }

  if (!isSuspiciousUserAgent(req.headers["user-agent"])) {
    return next();
  }

  securityLog("bot.blocked", {
    path: req.originalUrl,
    method: req.method,
    userAgent: req.headers["user-agent"]?.slice(0, 200),
  });
  next(new AppError("Request blocked.", 403));
};
