import logger from "../types/utils/logger";

export const OUTBOX_STATUSES = [
  "pending",
  "processing",
  "completed",
  "failed",
  "dead_letter",
] as const;

export type OutboxStatus = (typeof OUTBOX_STATUSES)[number];

/** Status after a failed dispatch attempt. */
export function nextOutboxStatusAfterFailure(
  attempts: number,
  maxAttempts: number,
): "pending" | "dead_letter" {
  return attempts >= maxAttempts ? "dead_letter" : "pending";
}

export function logOutboxDeadLetter(
  outboxType: string,
  outboxId: string,
  dedupeKey: string,
  attempts: number,
  error: string,
): void {
  logger.error({
    msg: "outbox_dead_letter",
    outboxType,
    outboxId,
    dedupeKey,
    attempts,
    error,
  });
}
