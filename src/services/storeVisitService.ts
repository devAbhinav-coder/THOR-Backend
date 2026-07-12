import StoreVisitSession from "../models/StoreVisitSession";
import { countryLabel, type VisitRequestMeta } from "./visitRequestMeta";

const IST_TZ = "Asia/Kolkata";
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

function istParts(date: Date): { year: number; month: number; day: number } {
  const shifted = new Date(date.getTime() + IST_OFFSET_MS);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth(),
    day: shifted.getUTCDate(),
  };
}

function istMidnight(year: number, monthIdx: number, day: number): Date {
  return new Date(Date.UTC(year, monthIdx, day) - IST_OFFSET_MS);
}

const fmtIso = new Intl.DateTimeFormat("sv-SE", {
  timeZone: IST_TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

export function istDateString(date = new Date()): string {
  return fmtIso.format(date);
}

export async function recordStoreVisit(
  sessionKey: string,
  path?: string,
  meta?: VisitRequestMeta,
) {
  const visitDate = istDateString();
  try {
    await StoreVisitSession.create({
      sessionKey,
      visitDate,
      path: path?.slice(0, 200),
      country: meta?.country,
      region: meta?.region?.slice(0, 120),
      referrerSource: meta?.referrerSource,
      device: meta?.device,
      utmSource: meta?.marketingAttribution?.utmSource,
      utmMedium: meta?.marketingAttribution?.utmMedium,
      utmCampaign: meta?.marketingAttribution?.utmCampaign,
      utmContent: meta?.marketingAttribution?.utmContent,
      utmTerm: meta?.marketingAttribution?.utmTerm,
      fbclid: meta?.marketingAttribution?.fbclid,
    });
    return { recorded: true, visitDate };
  } catch (err: unknown) {
    const code = (err as { code?: number })?.code;
    if (code === 11000) return { recorded: false, visitDate };
    throw err;
  }
}

function normalizeLandingPath(path?: string): string {
  const p = (path || "/").trim();
  if (!p || p === "/") return "Home";
  if (p.startsWith("/shop/")) return "Product / Shop";
  if (p.startsWith("/shop")) return "Shop";
  if (p.startsWith("/blog")) return "Blog";
  if (p.startsWith("/gifting")) return "Gifting";
  if (p.startsWith("/checkout")) return "Checkout";
  if (p.startsWith("/cart")) return "Cart";
  return p.length > 40 ? `${p.slice(0, 38)}…` : p;
}

export async function getStoreVisitStats() {
  const now = new Date();
  const ist = istParts(now);
  const startOfMonth = istMidnight(ist.year, ist.month, 1);
  const startOfDailyWindow = istMidnight(ist.year, ist.month, ist.day - 32);
  const todayStr = istDateString(now);
  const windowStartStr = istDateString(startOfDailyWindow);
  const insightMatch = { visitDate: { $gte: windowStartStr } };

  const [
    totalSiteVisits,
    siteVisitsToday,
    siteVisitsMtd,
    sparseByDay,
    byCountryRaw,
    bySourceRaw,
    byDeviceRaw,
    byPathRaw,
    byCampaignRaw,
    recentRaw,
  ] = await Promise.all([
    StoreVisitSession.countDocuments(),
    StoreVisitSession.countDocuments({ visitDate: todayStr }),
    StoreVisitSession.countDocuments({ createdAt: { $gte: startOfMonth } }),
    StoreVisitSession.aggregate([
      { $match: { visitDate: { $gte: windowStartStr } } },
      { $group: { _id: "$visitDate", visits: { $sum: 1 } } },
      { $sort: { _id: 1 as const } },
    ]),
    StoreVisitSession.aggregate([
      { $match: insightMatch },
      { $group: { _id: { $ifNull: ["$country", "UN"] }, visits: { $sum: 1 } } },
      { $sort: { visits: -1 as const } },
      { $limit: 8 },
    ]),
    StoreVisitSession.aggregate([
      { $match: insightMatch },
      { $group: { _id: { $ifNull: ["$referrerSource", "Direct"] }, visits: { $sum: 1 } } },
      { $sort: { visits: -1 as const } },
      { $limit: 8 },
    ]),
    StoreVisitSession.aggregate([
      { $match: insightMatch },
      { $group: { _id: { $ifNull: ["$device", "desktop"] }, visits: { $sum: 1 } } },
      { $sort: { visits: -1 as const } },
    ]),
    StoreVisitSession.aggregate([
      { $match: insightMatch },
      { $group: { _id: "$path", visits: { $sum: 1 } } },
      { $sort: { visits: -1 as const } },
      { $limit: 8 },
    ]),
    StoreVisitSession.aggregate([
      { $match: { ...insightMatch, utmCampaign: { $exists: true, $nin: [null, ""] } } },
      { $group: { _id: "$utmCampaign", visits: { $sum: 1 } } },
      { $sort: { visits: -1 as const } },
      { $limit: 8 },
    ]),
    StoreVisitSession.find()
      .sort("-createdAt")
      .limit(8)
      .select(
        "country region referrerSource device path createdAt visitDate utmSource utmCampaign utmContent utmMedium",
      )
      .lean(),
  ]);

  const dailyMap = new Map(
    (sparseByDay as { _id: string; visits: number }[]).map((r) => [r._id, r.visits]),
  );
  const anchor = new Date(`${todayStr}T12:00:00+05:30`);
  const visitsByDay: { date: string; visits: number }[] = [];
  for (let i = 0; i < 30; i++) {
    const d = new Date(anchor.getTime() - (29 - i) * 86400000);
    const date = fmtIso.format(d);
    visitsByDay.push({ date, visits: dailyMap.get(date) ?? 0 });
  }

  const visitsByCountry = (byCountryRaw as { _id: string; visits: number }[]).map((r) => ({
    code: r._id,
    label: countryLabel(r._id),
    visits: r.visits,
  }));

  const visitsBySource = (bySourceRaw as { _id: string; visits: number }[]).map((r) => ({
    source: r._id,
    visits: r.visits,
  }));

  const visitsByDevice = (byDeviceRaw as { _id: string; visits: number }[]).map((r) => ({
    device: r._id,
    visits: r.visits,
  }));

  const visitsByLandingPage = (byPathRaw as { _id: string; visits: number }[]).map((r) => ({
    page: normalizeLandingPath(r._id),
    visits: r.visits,
  }));

  const visitsByCampaign = (byCampaignRaw as { _id: string; visits: number }[]).map(
    (r) => ({
      campaign: r._id,
      visits: r.visits,
    }),
  );

  const recentVisits = (
    recentRaw as unknown as {
      country?: string;
      region?: string;
      referrerSource?: string;
      device?: string;
      path?: string;
      utmSource?: string;
      utmCampaign?: string;
      utmContent?: string;
      utmMedium?: string;
      createdAt?: Date;
    }[]
  ).map((r) => ({
    country: countryLabel(r.country),
    region: r.region || "",
    source: r.referrerSource || "Direct",
    device: r.device || "desktop",
    page: normalizeLandingPath(r.path),
    campaign:
      r.utmCampaign ||
      r.utmContent ||
      r.utmSource ||
      "",
    medium: r.utmMedium || "",
    at: r.createdAt ?? new Date(),
  }));

  return {
    totalSiteVisits,
    siteVisitsToday,
    siteVisitsMtd,
    visitsByDay,
    visitsByCountry,
    visitsBySource,
    visitsByDevice,
    visitsByLandingPage,
    visitsByCampaign,
    recentVisits,
  };
}
