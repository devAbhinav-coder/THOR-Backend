import logger from "./logger";
import { getRequestContext } from "./requestContext";

export type SecurityEvent =
  | "auth.failure"
  | "auth.refresh_limited"
  | "bot.blocked"
  | "checkout.concurrent_blocked"
  | "checkout.idempotent_replay"
  | "payment.verify_lock_busy"
  | "payment.verify_failed";

export function securityLog(
  event: SecurityEvent,
  detail: Record<string, unknown> = {}
): void {
  const ctx = getRequestContext();
  logger.warn({
    type: "security",
    event,
    requestId: ctx?.requestId,
    ip: ctx?.ip,
    ...detail,
  });
}
