/** Parse JWT expiresIn style values to seconds (e.g. 15m, 5m, 3600). */
export function parseExpiresInToSeconds(raw: string): number {
  const s = raw.trim();
  if (/^\d+$/.test(s)) {
    return Math.max(60, parseInt(s, 10));
  }
  const m = /^(\d+(?:\.\d+)?)([smhd])$/i.exec(s);
  if (!m) {
    return 900;
  }
  const n = parseFloat(m[1]!);
  const unit = m[2]!.toLowerCase();
  if (unit === "s") return Math.max(60, Math.round(n));
  if (unit === "m") return Math.max(60, Math.round(n * 60));
  if (unit === "h") return Math.max(60, Math.round(n * 3600));
  return Math.max(60, Math.round(n * 86400));
}

export function accessTokenExpiresInForRole(role?: string): string {
  if (role === "admin") {
    return process.env.JWT_ADMIN_EXPIRES_IN || "5m";
  }
  return process.env.JWT_EXPIRES_IN || "15m";
}

export function accessTokenTtlSeconds(role?: string): number {
  return parseExpiresInToSeconds(accessTokenExpiresInForRole(role));
}
