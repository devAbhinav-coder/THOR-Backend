/** Match browser `Origin` to env (trailing slash / casing mismatches break CORS silently). */
export function normalizeOriginUrl(origin: string): string {
  const t = origin.trim().replace(/\/+$/, "");
  try {
    const u = new URL(t);
    return `${u.protocol}//${u.host}`;
  } catch {
    return t;
  }
}

/** Same set used by CORS and optional Origin guard (CSRF-ish). */
export function getCorsAllowedOriginSet(): Set<string> {
  return new Set(
    (
      process.env.FRONTEND_URLS ||
      process.env.FRONTEND_URL ||
      "http://localhost:3000"
    )
      .split(",")
      .map((s) => normalizeOriginUrl(s.trim()))
      .filter(Boolean),
  );
}
