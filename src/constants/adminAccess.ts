/** Admin panel areas - full admins have all; staff get a custom subset. */
export const ADMIN_ACCESS_AREAS = [
  "overview",
  "catalog",
  "storefront",
  "sales",
  "marketing",
  "customers",
  "system",
] as const;

export type AdminAccessArea = (typeof ADMIN_ACCESS_AREAS)[number];

export const ADMIN_ACCESS_AREA_LABELS: Record<AdminAccessArea, string> = {
  overview: "Overview (dashboard, analytics, revenue, costs, AI)",
  catalog: "Catalog (categories, products, inventory, premium)",
  storefront: "Storefront (homepage & shop settings)",
  sales: "Sales (orders, returns, coupons, offers, invoices)",
  marketing: "Marketing & content (blogs, email, WhatsApp, stories)",
  customers: "Customers & trust (users directory, reviews)",
  system: "System (security audit, jobs, outbox)",
};

/** Common preset for marketing teammates. */
export const ADMIN_ACCESS_PRESET_MARKETING: AdminAccessArea[] = [
  "storefront",
  "marketing",
];

export function isAdminAccessArea(value: string): value is AdminAccessArea {
  return (ADMIN_ACCESS_AREAS as readonly string[]).includes(value);
}

export function normalizeAdminPermissions(raw: unknown): AdminAccessArea[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<AdminAccessArea>();
  for (const item of raw) {
    if (typeof item === "string" && isAdminAccessArea(item)) {
      seen.add(item);
    }
  }
  return ADMIN_ACCESS_AREAS.filter((a) => seen.has(a));
}

export function isAdminPanelUser(user: {
  role?: string;
  adminPermissions?: string[];
}): boolean {
  if (user.role === "admin") return true;
  if (user.role !== "staff") return false;
  const perms = normalizeAdminPermissions(user.adminPermissions);
  return perms.length > 0;
}

export function userHasAdminArea(
  user: { role?: string; adminPermissions?: string[] },
  area: AdminAccessArea,
): boolean {
  if (user.role === "admin") return true;
  if (user.role !== "staff") return false;
  return normalizeAdminPermissions(user.adminPermissions).includes(area);
}

function normalizeAdminApiPath(path: string): string {
  let p = path.split("?")[0] || "/";
  if (p.startsWith("/api/admin")) {
    p = p.slice("/api/admin".length) || "/";
  }
  if (!p.startsWith("/")) p = `/${p}`;
  if (p.length > 1 && p.endsWith("/")) p = p.slice(0, -1);
  return p;
}

const ADMIN_ONLY_PREFIXES = [
  "/users",
  "/security",
  "/outbox",
  "/jobs",
  "/offline-customers",
] as const;

/**
 * Maps `/api/admin` relative paths to a required area.
 * `admin_only` = full admin only. `null` = unknown (deny staff).
 */
export function adminAreaForApiPath(
  path: string,
): AdminAccessArea | "admin_only" | null {
  const p = normalizeAdminApiPath(path);

  for (const prefix of ADMIN_ONLY_PREFIXES) {
    if (p === prefix || p.startsWith(`${prefix}/`)) return "admin_only";
  }

  if (p === "/analytics" || p.startsWith("/analytics/")) return "overview";
  if (p === "/revenue" || p.startsWith("/revenue/")) return "overview";
  if (p.startsWith("/operating-expenses")) return "overview";

  if (p.startsWith("/ai")) {
    if (
      p.includes("/draft/blog") ||
      p.includes("/draft/marketing") ||
      p.includes("blog-calendar")
    ) {
      return "marketing";
    }
    if (p.includes("/draft/product") || p.includes("/draft/catalog")) {
      return "catalog";
    }
    return "overview";
  }

  if (p.startsWith("/writes/products")) return "catalog";
  if (
    p.startsWith("/writes/coupons") ||
    p.startsWith("/writes/sales") ||
    p.startsWith("/writes/promotions")
  ) {
    return "sales";
  }
  if (p.startsWith("/writes/blogs") || p.startsWith("/writes/testimonials")) {
    return "marketing";
  }

  if (p.startsWith("/storefront")) return "storefront";

  if (
    p.startsWith("/products") ||
    p.startsWith("/categories") ||
    p.startsWith("/subcategories") ||
    p.startsWith("/inventory")
  ) {
    return "catalog";
  }

  if (
    p.startsWith("/orders") ||
    p.startsWith("/returns") ||
    p.startsWith("/invoices") ||
    p.startsWith("/delhivery")
  ) {
    return "sales";
  }

  if (
    p.startsWith("/emails") ||
    p.startsWith("/whatsapp") ||
    p.startsWith("/newsletter") ||
    p.startsWith("/blog-content-plans")
  ) {
    return "marketing";
  }

  if (p.startsWith("/reviews")) return "customers";

  return null;
}

export type ExternalAdminApiKind = "products" | "blogs" | "testimonials";

export function adminAreaForExternalAdminApi(
  kind: ExternalAdminApiKind,
): AdminAccessArea {
  if (kind === "products") return "catalog";
  return "marketing";
}
