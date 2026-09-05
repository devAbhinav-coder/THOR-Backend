/**
 * Admin mutations that also live outside `/api/admin/*`.
 * Legacy routes now require `requireAdminTwoFactor` (same as `/api/admin`).
 * Preferred clients still use `/api/admin/writes/*`.
 */
export const ADMIN_WRITE_SURFACES: ReadonlyArray<{
  methods: string;
  path: string;
  adminAlias: string;
}> = [
  { methods: "POST|PATCH|DELETE", path: "/api/products", adminAlias: "/api/admin/writes/products" },
  { methods: "POST|PATCH|DELETE", path: "/api/coupons", adminAlias: "/api/admin/writes/coupons" },
  { methods: "POST|PATCH|DELETE", path: "/api/sales", adminAlias: "/api/admin/writes/sales" },
  { methods: "POST|PATCH|DELETE", path: "/api/promotions", adminAlias: "/api/admin/writes/promotions" },
  { methods: "POST|PATCH|DELETE", path: "/api/blogs", adminAlias: "/api/admin/writes/blogs" },
  { methods: "POST|PATCH|DELETE", path: "/api/testimonials", adminAlias: "/api/admin/writes/testimonials" },
  { methods: "PATCH", path: "/api/gifting/requests", adminAlias: "/api/admin/gifting/requests" },
];
