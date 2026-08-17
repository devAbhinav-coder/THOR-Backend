/** Placeholder emails for POS / offline guests without a real inbox. */
const NON_DELIVERABLE_SUFFIXES = ["@offline.local", "@review.local"] as const;

const EMAIL_RE =
  /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/i;

/**
 * True when we should send customer-facing transactional email.
 * Skips empty, invalid, and synthetic offline/review placeholder addresses.
 */
export function isCustomerDeliverableEmail(
  email?: string | null,
): email is string {
  if (!email || typeof email !== "string") return false;
  const normalized = email.trim().toLowerCase();
  if (!normalized || !EMAIL_RE.test(normalized)) return false;
  return !NON_DELIVERABLE_SUFFIXES.some((suffix) =>
    normalized.endsWith(suffix),
  );
}
