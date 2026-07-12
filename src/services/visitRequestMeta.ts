import type { Request } from "express";

export type VisitDevice = "mobile" | "tablet" | "desktop";

export type VisitRequestMeta = {
  country: string;
  region?: string;
  referrerSource: string;
  device: VisitDevice;
  marketingAttribution?: {
    utmSource?: string;
    utmMedium?: string;
    utmCampaign?: string;
    utmContent?: string;
    utmTerm?: string;
    fbclid?: string;
  };
};

const COUNTRY_NAMES: Record<string, string> = {
  IN: "India",
  US: "United States",
  GB: "United Kingdom",
  AE: "UAE",
  CA: "Canada",
  AU: "Australia",
  SG: "Singapore",
  DE: "Germany",
  FR: "France",
  PK: "Pakistan",
  BD: "Bangladesh",
  NP: "Nepal",
  LK: "Sri Lanka",
};

export function countryLabel(code: string | undefined): string {
  const c = (code || "").trim().toUpperCase();
  if (!c || c === "XX" || c === "T1") return "Unknown";
  return COUNTRY_NAMES[c] ? `${COUNTRY_NAMES[c]} (${c})` : c;
}

function headerStr(req: Request, name: string): string | undefined {
  const v = req.headers[name.toLowerCase()];
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}

export function resolveVisitCountry(req: Request): string {
  return (
    headerStr(req, "cf-ipcountry") ||
    headerStr(req, "x-vercel-ip-country") ||
    headerStr(req, "cloudfront-viewer-country") ||
    "UN"
  ).toUpperCase();
}

export function resolveVisitRegion(req: Request): string | undefined {
  const city = headerStr(req, "x-vercel-ip-city");
  const regionCode =
    headerStr(req, "x-vercel-ip-country-region") ||
    headerStr(req, "cf-region");
  if (city && regionCode) return `${city}, ${regionCode}`;
  return city || regionCode;
}

export function deviceFromUserAgent(ua: string): VisitDevice {
  if (!ua) return "desktop";
  if (/ipad|tablet|playbook|silk/i.test(ua)) return "tablet";
  if (/mobile|iphone|ipod|android.*mobile|windows phone/i.test(ua)) return "mobile";
  return "desktop";
}

export function classifyReferrer(referrer?: string): string {
  const raw = referrer?.trim();
  if (!raw) return "Direct";

  try {
    const host = new URL(raw).hostname.replace(/^www\./i, "").toLowerCase();
    if (!host) return "Direct";
    if (host.includes("google.")) return "Google";
    if (host.includes("instagram.") || host === "l.instagram.com") return "Instagram";
    if (host.includes("facebook.") || host === "fb.com" || host === "m.facebook.com") return "Facebook";
    if (host.includes("youtube.") || host === "youtu.be") return "YouTube";
    if (host.includes("whatsapp.")) return "WhatsApp";
    if (host.includes("twitter.") || host === "t.co" || host.includes("x.com")) return "X / Twitter";
    if (host.includes("pinterest.")) return "Pinterest";
    if (host.includes("bing.")) return "Bing";
    if (host.includes("linkedin.")) return "LinkedIn";
    return host.length > 32 ? `${host.slice(0, 30)}…` : host;
  } catch {
    return "Direct";
  }
}

export function visitRequestMeta(req: Request, clientReferrer?: string): VisitRequestMeta {
  const ua = headerStr(req, "user-agent") || "";
  return {
    country: resolveVisitCountry(req),
    region: resolveVisitRegion(req),
    referrerSource: classifyReferrer(clientReferrer),
    device: deviceFromUserAgent(ua),
  };
}
