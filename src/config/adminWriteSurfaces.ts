/**
 * Admin mutations that also live outside `/api/admin/*`.
 * WAF / Cloudflare should rate-limit and optionally geo-restrict these
 * methods. Preferred clients use `/api/admin/writes/*` (2FA already applied).
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
