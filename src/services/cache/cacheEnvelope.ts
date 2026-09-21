import { getCache, setCache } from "../cacheService";

export type CacheEnvelope<T> = {
  data: T;
  storedAt: number;
  softTtlSec: number;
  hardTtlSec: number;
};

export function isEnvelopeRecord(raw: unknown): raw is CacheEnvelope<unknown> {
  if (!raw || typeof raw !== "object") return false;
  const o = raw as Record<string, unknown>;
  return (
    "data" in o &&
    typeof o.storedAt === "number" &&
    typeof o.softTtlSec === "number" &&
    typeof o.hardTtlSec === "number"
  );
}

export async function getCacheEnvelope<T>(
  key: string,
): Promise<CacheEnvelope<T> | null> {
  const raw = await getCache<unknown>(key);
  if (raw === null) return null;
  if (isEnvelopeRecord(raw)) {
    return raw as CacheEnvelope<T>;
  }
  return null;
}

export async function setCacheEnvelope<T>(
  key: string,
  data: T,
  opts: { softTtlSec: number; hardTtlSec: number },
): Promise<void> {
  const hardTtlSec = Math.max(opts.hardTtlSec, opts.softTtlSec);
  const envelope: CacheEnvelope<T> = {
    data,
    storedAt: Date.now(),
    softTtlSec: opts.softTtlSec,
    hardTtlSec,
  };
  await setCache(key, envelope, hardTtlSec);
}

export function envelopeAgeSec(envelope: CacheEnvelope<unknown>, now = Date.now()): number {
  return (now - envelope.storedAt) / 1000;
}

export function isEnvelopeFresh(
  envelope: CacheEnvelope<unknown>,
  now = Date.now(),
): boolean {
  return envelopeAgeSec(envelope, now) <= envelope.softTtlSec;
}

export function isEnvelopeStaleButValid(
  envelope: CacheEnvelope<unknown>,
  now = Date.now(),
): boolean {
  const age = envelopeAgeSec(envelope, now);
  return age > envelope.softTtlSec && age <= envelope.hardTtlSec;
}
