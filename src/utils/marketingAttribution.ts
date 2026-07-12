export type MarketingAttribution = {
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  utmContent?: string;
  utmTerm?: string;
  fbclid?: string;
  landingPath?: string;
  capturedAt?: Date;
};

function trimField(value: unknown, max: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const v = value.trim();
  if (!v) return undefined;
  return v.slice(0, max);
}

export function sanitizeMarketingAttribution(
  raw: unknown,
): MarketingAttribution | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const o = raw as Record<string, unknown>;

  let capturedAt: Date | undefined;
  if (typeof o.capturedAt === "string" && o.capturedAt.trim()) {
    const d = new Date(o.capturedAt);
    if (!Number.isNaN(d.getTime())) capturedAt = d;
  }

  const result: MarketingAttribution = {
    utmSource: trimField(o.utmSource, 120),
    utmMedium: trimField(o.utmMedium, 120),
    utmCampaign: trimField(o.utmCampaign, 200),
    utmContent: trimField(o.utmContent, 200),
    utmTerm: trimField(o.utmTerm, 200),
    fbclid: trimField(o.fbclid, 200),
    landingPath: trimField(o.landingPath, 200),
    capturedAt,
  };

  const hasValue = Boolean(
    result.utmSource ||
      result.utmMedium ||
      result.utmCampaign ||
      result.utmContent ||
      result.utmTerm ||
      result.fbclid,
  );
  return hasValue ? result : undefined;
}

export function attributionCampaignLabel(
  attribution?: MarketingAttribution | null,
): string | null {
  if (!attribution) return null;
  return (
    attribution.utmCampaign ||
    attribution.utmContent ||
    attribution.utmSource ||
    (attribution.fbclid ? "Meta ad" : null)
  );
}
