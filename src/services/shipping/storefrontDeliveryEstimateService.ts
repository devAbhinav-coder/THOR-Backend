import {
  delhiveryIsConfigured,
  delhiveryOriginPincode,
} from "../../config/delhivery";
import {
  checkPincodeServiceability,
  fetchTatHint,
} from "../delhiveryService";
import { getLearnedTransitDays } from "./deliveryTatLearningService";
import { lookupIndiaPostPincode } from "./indiaPostPincodeLookup";
import {
  normalizeStateName,
  resolvePincodeGeo,
} from "./indiaPincodeZones";

const CACHE_TTL_MS = 2 * 60 * 60 * 1000;
const CUTOFF_HOUR_IST = 14;

export type EstimateSource = "learned" | "carrier" | "zone";

export type StorefrontDeliveryEstimate = {
  serviceable: boolean;
  pincode: string;
  city?: string;
  state?: string;
  zone?: string;
  zoneLabel?: string;
  tatDaysMin: number;
  tatDaysMax: number;
  estimatedDelivery: { from: string; to: string };
  promisedDate: string;
  dispatchDaysMin: number;
  dispatchDaysMax: number;
  carrier: string;
  source: EstimateSource;
  fallback: boolean;
  message?: string;
};

type CacheEntry = { expiresAt: number; value: StorefrontDeliveryEstimate };

const estimateCache = new Map<string, CacheEntry>();

function istNow(): Date {
  return new Date(
    new Date().toLocaleString("en-US", { timeZone: "Asia/Kolkata" }),
  );
}

function istDateKey(): string {
  const d = istNow();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Courier working day in India: Sunday off, Saturday delivers. */
function isNonDeliveryDay(date: Date): boolean {
  return date.getDay() === 0;
}

export function addCourierDays(from: Date, days: number): Date {
  const result = new Date(from);
  let added = 0;
  const safeDays = Math.max(0, days);
  while (added < safeDays) {
    result.setDate(result.getDate() + 1);
    if (!isNonDeliveryDay(result)) added += 1;
  }
  return result;
}

function toIsoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function dispatchSla(): { min: number; max: number } {
  const now = istNow();
  const afterCutoff =
    now.getDay() === 0 || now.getHours() >= CUTOFF_HOUR_IST;
  const days = afterCutoff ? 2 : 1;
  return { min: days, max: days };
}

function extractPinLocation(raw: unknown): { city?: string; state?: string } {
  const rows = extractPinRows(raw);
  if (rows.length === 0) return {};
  const row = rows[0] as Record<string, unknown>;
  const postal =
    row.postal_code && typeof row.postal_code === "object" ?
      (row.postal_code as Record<string, unknown>)
    : row;

  const cityRaw =
    firstString(postal, [
      "city",
      "city_name",
      "district",
      "District",
      "taluka",
      "region",
    ]) || firstString(row, ["city", "district", "city_name"]);
  const stateRaw =
    firstString(postal, ["state_code", "state_name", "state", "State"]) ||
    firstString(row, ["state_code", "state"]);

  return {
    city: cityRaw ? titleCaseCity(cityRaw) : undefined,
    state: normalizeStateName(stateRaw),
  };
}

function titleCaseCity(value: string): string {
  return value
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function firstString(
  obj: Record<string, unknown> | undefined,
  keys: string[],
): string | undefined {
  if (!obj) return undefined;
  for (const key of keys) {
    const v = obj[key];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return undefined;
}

function extractPinRows(json: unknown): unknown[] {
  if (Array.isArray(json)) return json;
  if (json && typeof json === "object") {
    const o = json as Record<string, unknown>;
    if (Array.isArray(o.delivery_codes)) return o.delivery_codes;
    if (Array.isArray(o.pin_codes)) return o.pin_codes;
  }
  return [];
}

function buildEstimate(params: {
  pincode: string;
  serviceable: boolean;
  tatDaysMin: number;
  tatDaysMax: number;
  source: EstimateSource;
  fallback: boolean;
  city?: string;
  state?: string;
  zone?: string;
  zoneLabel?: string;
  message?: string;
}): StorefrontDeliveryEstimate {
  const today = istNow();
  today.setHours(12, 0, 0, 0);

  const dispatch = dispatchSla();
  const transitTypical = Math.round(
    (params.tatDaysMin + params.tatDaysMax) / 2,
  );
  const promised = addCourierDays(today, dispatch.max + transitTypical);
  const from = addCourierDays(today, dispatch.min + params.tatDaysMin);
  const to = addCourierDays(today, dispatch.max + params.tatDaysMax);

  const fromIso = toIsoDate(from < promised ? from : promised);
  const toIso = toIsoDate(to > promised ? to : promised);

  return {
    serviceable: params.serviceable,
    pincode: params.pincode,
    city: params.city,
    state: params.state,
    zone: params.zone,
    zoneLabel: params.zoneLabel,
    tatDaysMin: params.tatDaysMin,
    tatDaysMax: params.tatDaysMax,
    estimatedDelivery: { from: fromIso, to: toIso },
    promisedDate: toIsoDate(promised),
    dispatchDaysMin: dispatch.min,
    dispatchDaysMax: dispatch.max,
    carrier: "Delhivery",
    source: params.source,
    fallback: params.fallback,
    message: params.message,
  };
}

export async function getStorefrontDeliveryEstimate(
  pin: string,
): Promise<StorefrontDeliveryEstimate> {
  const pincode = pin.replace(/\D/g, "").slice(0, 6);
  if (pincode.length !== 6) {
    throw new Error("Invalid 6-digit pincode");
  }

  const cacheKey = `${pincode}:${istDateKey()}`;
  const cached = estimateCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value;
  }

  const geo = resolvePincodeGeo(pincode);
  const zoneTransit = {
    min: geo.transitDaysMin,
    max: geo.transitDaysMax,
  };

  let city: string | undefined;
  let state = geo.state;
  let serviceable = true;
  let unserviceableMessage: string | undefined;

  const [delhiveryResult, postalLookup] = await Promise.all([
    delhiveryIsConfigured() ?
      checkPincodeServiceability(pincode).catch(() => null)
    : Promise.resolve(null),
    lookupIndiaPostPincode(pincode),
  ]);

  if (delhiveryResult) {
    const location = extractPinLocation(delhiveryResult.raw);
    city = location.city;
    if (location.state) state = location.state;
    if (!delhiveryResult.serviceable) {
      serviceable = false;
      unserviceableMessage =
        delhiveryResult.remark ?
          `Delivery unavailable — ${delhiveryResult.remark}`
        : "Sorry, we cannot deliver to this pincode yet.";
    }
  }

  if (!city && postalLookup.city) city = postalLookup.city;
  if (postalLookup.state) {
    const postalState = normalizeStateName(postalLookup.state);
    if (postalState && (!delhiveryResult || state === geo.state)) {
      state = postalState;
    }
  }

  if (!serviceable) {
    const value = buildEstimate({
      pincode,
      serviceable: false,
      tatDaysMin: 0,
      tatDaysMax: 0,
      source: "zone",
      fallback: false,
      city,
      state,
      zone: geo.zone,
      zoneLabel: geo.zoneLabel,
      message: unserviceableMessage,
    });
    estimateCache.set(cacheKey, {
      expiresAt: Date.now() + CACHE_TTL_MS,
      value,
    });
    return value;
  }

  let tatDaysMin = zoneTransit.min;
  let tatDaysMax = zoneTransit.max;
  let source: EstimateSource = "zone";

  const learned = await getLearnedTransitDays(pincode);
  if (learned) {
    tatDaysMin = Math.max(1, learned.days - 1);
    tatDaysMax = learned.days + 1;
    source = "learned";
  }

  if (delhiveryIsConfigured() && delhiveryOriginPincode()) {
    try {
      const tat = await fetchTatHint({
        origin_pin: delhiveryOriginPincode()!,
        destination_pin: pincode,
        mot: "S",
      });
      if (tat.ok && typeof tat.tatDays === "number" && tat.tatDays > 0) {
        tatDaysMin = tat.tatDays;
        tatDaysMax = tat.tatDays + 1;
        source = "carrier";
      }
    } catch {
      /* keep zone / learned */
    }
  }

  const value = buildEstimate({
    pincode,
    serviceable: true,
    tatDaysMin,
    tatDaysMax,
    source,
    fallback: false,
    city,
    state,
    zone: geo.zone,
    zoneLabel: geo.zoneLabel,
    message:
      source === "zone" ?
        `${geo.zoneLabel} corridor from our Noida warehouse`
      : source === "learned" ?
        "Based on recent deliveries to your area"
      : undefined,
  });

  estimateCache.set(cacheKey, {
    expiresAt: Date.now() + CACHE_TTL_MS,
    value,
  });
  return value;
}
