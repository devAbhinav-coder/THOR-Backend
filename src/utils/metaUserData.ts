import crypto from "crypto";

export type MetaUserDataInput = {
  email?: string;
  phone?: string;
  externalId?: string;
  firstName?: string;
  lastName?: string;
  city?: string;
  state?: string;
  zip?: string;
  country?: string;
};

export type MetaCapiUserData = {
  client_ip_address?: string;
  client_user_agent?: string;
  fbp?: string;
  fbc?: string;
  em?: string;
  ph?: string;
  external_id?: string;
  fn?: string;
  ln?: string;
  ct?: string;
  st?: string;
  zp?: string;
  country?: string;
};

const hash = (value: string) =>
  crypto.createHash("sha256").update(value.trim().toLowerCase()).digest("hex");

/** Meta CAPI phone: digits only with country code (E.164 without +). */
export function normalizeMetaPhone(phone: string, defaultCountry = "91"): string | undefined {
  const digits = phone.replace(/\D/g, "");
  if (!digits) return undefined;

  const last10 = digits.slice(-10);
  if (/^[6-9]\d{9}$/.test(last10)) {
    return `${defaultCountry}${last10}`;
  }

  if (digits.length >= 11 && digits.length <= 15) {
    return digits;
  }

  return undefined;
}

export function normalizeMetaEmail(email: string): string | undefined {
  const normalized = email.trim().toLowerCase();
  return normalized.includes("@") ? normalized : undefined;
}

export function splitFullName(name?: string): { firstName?: string; lastName?: string } {
  const parts = name?.trim().split(/\s+/).filter(Boolean) ?? [];
  if (!parts.length) return {};
  if (parts.length === 1) return { firstName: parts[0] };
  return {
    firstName: parts[0],
    lastName: parts.slice(1).join(" "),
  };
}

function headerStr(
  headers: Record<string, string | string[] | undefined> | undefined,
  name: string,
): string | undefined {
  const v = headers?.[name.toLowerCase()];
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}

export function resolveClientIp(req: {
  ip?: string;
  socket?: { remoteAddress?: string };
  headers?: Record<string, string | string[] | undefined>;
}): string | undefined {
  const forwarded = req.headers?.["x-forwarded-for"];
  const forwardedIp =
    typeof forwarded === "string" ? forwarded.split(",")[0]?.trim() : undefined;
  const raw =
    headerStr(req.headers, "cf-connecting-ip") ||
    headerStr(req.headers, "true-client-ip") ||
    forwardedIp ||
    (typeof req.ip === "string" ? req.ip : undefined) ||
    req.socket?.remoteAddress;

  if (!raw || raw === "unknown") return undefined;

  const normalized = raw.replace(/^::ffff:/, "");
  if (normalized === "127.0.0.1" || normalized === "::1") return undefined;
  return normalized;
}

function normalizePersonName(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z\u00c0-\u024f\u0900-\u097f\s]/g, "")
    .replace(/\s+/g, " ");
}

function normalizePlace(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]/gi, "");
}

function compactUserData(data: MetaCapiUserData): MetaCapiUserData {
  return Object.fromEntries(
    Object.entries(data).filter(([, value]) => typeof value === "string" && value.length > 0),
  ) as MetaCapiUserData;
}

export function buildMetaCapiUserData(
  context: {
    ip?: string;
    userAgent?: string;
    fbp?: string;
    fbc?: string;
  },
  user?: MetaUserDataInput,
): MetaCapiUserData {
  const email = user?.email ? normalizeMetaEmail(user.email) : undefined;
  const phone = user?.phone ? normalizeMetaPhone(user.phone) : undefined;
  const hasIdentity = Boolean(email || phone || user?.firstName || user?.city);
  const countryRaw = user?.country?.trim();
  const countryCode =
    !hasIdentity ? undefined
    : !countryRaw || countryRaw.toLowerCase() === "india" ? "in"
    : countryRaw.slice(0, 2).toLowerCase();

  return compactUserData({
    client_ip_address: context.ip,
    client_user_agent: context.userAgent,
    fbp: context.fbp?.trim(),
    fbc: context.fbc?.trim(),
    em: email ? hash(email) : undefined,
    ph: phone ? hash(phone) : undefined,
    external_id: user?.externalId?.trim() ? hash(user.externalId) : undefined,
    fn: user?.firstName?.trim() ? hash(normalizePersonName(user.firstName)) : undefined,
    ln: user?.lastName?.trim() ? hash(normalizePersonName(user.lastName)) : undefined,
    ct: user?.city?.trim() ? hash(normalizePlace(user.city)) : undefined,
    st: user?.state?.trim() ? hash(normalizePlace(user.state)) : undefined,
    zp: user?.zip?.trim() ? hash(user.zip.replace(/\s+/g, "")) : undefined,
    country: countryCode ? hash(countryCode) : undefined,
  });
}

export function buildMetaCapiUserDataFromOrder(
  context: {
    ip?: string;
    userAgent?: string;
    fbp?: string;
    fbc?: string;
  },
  order: {
    email?: string;
    user?: { email?: string; _id?: { toString(): string } };
    shippingAddress?: {
      name?: string;
      phone?: string;
      city?: string;
      state?: string;
      pincode?: string;
      country?: string;
    };
  },
  userId?: string,
): MetaCapiUserData {
  const email = ((order as { email?: string }).email || order.user?.email || "")
    .toString()
    .trim();
  const phone = (order.shippingAddress?.phone || "").toString().trim();
  const { firstName, lastName } = splitFullName(order.shippingAddress?.name);

  return buildMetaCapiUserData(context, {
    email: email || undefined,
    phone: phone || undefined,
    externalId: userId || order.user?._id?.toString(),
    firstName,
    lastName,
    city: order.shippingAddress?.city,
    state: order.shippingAddress?.state,
    zip: order.shippingAddress?.pincode,
    country: order.shippingAddress?.country || "India",
  });
}
