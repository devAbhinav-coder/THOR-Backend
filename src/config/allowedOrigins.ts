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

/**
 * Browsers send `Origin` as the exact site the user opened (e.g. https://www.site.com vs https://site.com).
 * If only one is listed in env, CORS + csrfOriginGuard reject the other — feels "random" when users/bookmarks
 * switch host. Mirror www ↔ apex for simple `name.tld` hosts and strip/add `www.` when already present.
 */
function expandWwwApexMirror(allowed: Set<string>): void {
  const additions: string[] = [];
  for (const origin of allowed) {
    let u: URL;
    try {
      u = new URL(origin);
    } catch {
      continue;
    }
    const host = u.hostname;
    if (host === "localhost" || host.endsWith(".localhost")) continue;
    if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) continue;

    if (host.startsWith("www.")) {
      const bare = host.slice(4);
      additions.push(normalizeOriginUrl(`${u.protocol}//${bare}`));
      continue;
    }

    // e.g. example.com — also allow https://www.example.com
    const parts = host.split(".");
    if (parts.length === 2) {
      additions.push(normalizeOriginUrl(`${u.protocol}//www.${host}`));
    }
  }
  for (const a of additions) {
    if (a) allowed.add(a);
  }
}

/** Same set used by CORS and optional Origin guard (CSRF-ish). */
export function getCorsAllowedOriginSet(): Set<string> {
  const set = new Set(
    (
      process.env.FRONTEND_URLS ||
      process.env.FRONTEND_URL ||
      "http://localhost:3000"
    )
      .split(",")
      .map((s) => normalizeOriginUrl(s.trim()))
      .filter(Boolean),
  );
  expandWwwApexMirror(set);
  return set;
}
