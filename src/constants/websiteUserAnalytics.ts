/** Synthetic inboxes - not real shopper accounts. */
export const SYNTHETIC_CUSTOMER_EMAIL_REGEX = /@(offline|review)\.local$/i;

/** Real storefront accounts (signup / OTP) - not POS-only offline lead profiles. */
export const WEBSITE_REGISTERED_USER_MATCH = {
  role: "user" as const,
  offlineLead: { $ne: true as const },
} as const;

/** Admin Users directory: website customers only (matches analytics signups). */
export function websiteCustomerDirectoryFilter(
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    ...WEBSITE_REGISTERED_USER_MATCH,
    email: {
      $not: { $regex: SYNTHETIC_CUSTOMER_EMAIL_REGEX.source, $options: "i" },
    },
    ...extra,
  };
}

/**
 * Admin customer list: website signups + POS/guest profiles that have a valid mobile on file.
 */
export function adminCustomerDirectoryFilter(
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    role: "user" as const,
    $or: [
      {
        offlineLead: { $ne: true },
        email: {
          $not: {
            $regex: SYNTHETIC_CUSTOMER_EMAIL_REGEX.source,
            $options: "i",
          },
        },
      },
      { phone: { $regex: /^(\+?91[\s-]?)?[6-9]\d{9}$/ } },
    ],
    ...extra,
  };
}

/** `$group` / `$cond` helper for directory stats aggregation. */
export function isWebsiteCustomerAccountExpr(): Record<string, unknown> {
  return {
    $and: [
      { $eq: ["$role", "user"] },
      { $ne: ["$offlineLead", true] },
      {
        $not: {
          $regexMatch: {
            input: { $toLower: { $ifNull: ["$email", ""] } },
            regex: "@(offline|review)\\.local$",
          },
        },
      },
    ],
  };
}

/** Same filter on `$lookup` user documents (e.g. `userDoc.role`). */
export const WEBSITE_REGISTERED_USER_DOC_MATCH = {
  "userDoc.role": "user" as const,
  "userDoc.offlineLead": { $ne: true as const },
} as const;

/** Paid checkout on the website (excludes admin offline / B2B POS orders). */
export const WEBSITE_ONLINE_PAID_ORDER_MATCH = {
  paymentStatus: "paid" as const,
  user: { $exists: true, $ne: null },
  offlineMeta: { $exists: false },
} as const;
