/**
 * Delhivery B2C API — base URL and credentials from env.
 * Staging: https://staging-express.delhivery.com
 * Production: https://track.delhivery.com
 */

const STAGING = "https://staging-express.delhivery.com";
const PRODUCTION = "https://track.delhivery.com";

export function delhiveryBaseUrl(): string {
  const raw = process.env.DELHIVERY_USE_STAGING?.trim().toLowerCase();
  const staging = raw === "1" || raw === "true" || raw === "yes";
  return staging ? STAGING : PRODUCTION;
}

export function delhiveryToken(): string | undefined {
  return process.env.DELHIVERY_API_TOKEN?.trim() || undefined;
}

export function delhiveryPickupLocationName(): string | undefined {
  return process.env.DELHIVERY_PICKUP_LOCATION_NAME?.trim() || undefined;
}

export function delhiveryOriginPincode(): string | undefined {
  return process.env.DELHIVERY_ORIGIN_PINCODE?.trim() || undefined;
}

export function delhiveryIsConfigured(): boolean {
  return Boolean(
    delhiveryToken() && delhiveryPickupLocationName() && delhiveryOriginPincode(),
  );
}

export function delhiveryTrackingPublicUrl(waybill: string): string {
  const w = encodeURIComponent(waybill.trim());
  return `https://www.delhivery.com/track/package/${w}`;
}
