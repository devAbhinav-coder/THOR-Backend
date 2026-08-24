import { normalizeStateName } from "./indiaPincodeZones";

type PostalLocation = { city?: string; state?: string };

const cache = new Map<string, { expiresAt: number; value: PostalLocation }>();
const TTL_MS = 24 * 60 * 60 * 1000;

function titleCaseCity(value: string): string {
  return value
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

/**
 * India Post public PIN lookup — fills city/district when Delhivery omits it.
 */
export async function lookupIndiaPostPincode(
  pin: string,
): Promise<PostalLocation> {
  const pincode = pin.replace(/\D/g, "").slice(0, 6);
  if (pincode.length !== 6) return {};

  const cached = cache.get(pincode);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 2500);

  try {
    const res = await fetch(
      `https://api.postalpincode.in/pincode/${pincode}`,
      { signal: ctrl.signal, headers: { Accept: "application/json" } },
    );
    const json: unknown = await res.json();
    const row = Array.isArray(json) ? json[0] : json;
    if (!row || typeof row !== "object") return {};

    const offices = (row as { PostOffice?: unknown }).PostOffice;
    if (!Array.isArray(offices) || offices.length === 0) return {};

    const office = offices[0] as Record<string, unknown>;
    const district =
      typeof office.District === "string" ? office.District.trim() : "";
    const division =
      typeof office.Division === "string" ? office.Division.trim() : "";
    const block =
      typeof office.Block === "string" ? office.Block.trim() : "";
    const stateRaw =
      typeof office.State === "string" ? office.State.trim() : "";

    const city = titleCaseCity(district || division || block);
    const value: PostalLocation = {
      city: city || undefined,
      state: normalizeStateName(stateRaw),
    };
    cache.set(pincode, { expiresAt: Date.now() + TTL_MS, value });
    return value;
  } catch {
    return {};
  } finally {
    clearTimeout(timer);
  }
}
