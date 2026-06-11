import logger from "./logger";
import { getRequestContext } from "./requestContext";

export type SecurityEvent =
  | "auth.failure"
  | "auth.refresh_limited"
  | "auth.otp_abuse"
  | "auth.suspicious_ip"
  | "bot.blocked"
  | "checkout.concurrent_blocked"
  | "checkout.idempotent_replay"
  | "payment.verify_lock_busy"
  | "payment.verify_failed"
  | "payment.verify_success"
  | "payment.verify_replay"
  | "payment.idempotent_replay"
  | "payment.webhook_received"
  | "payment.webhook_reconciled"
  | "payment.recovery_reconciled"
  | "payment.prepare_lock_busy"
  | "auth.otp_send"
  | "auth.otp_verify_success"
  | "auth.otp_verify_failed"
  | "auth.otp_idempotent_replay"
  | "auth.otp_verify_throttled"
  | "order.cancel.by_customer"
  | "order.cancel.abuse";

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
