import Order from "../../models/Order";
import logger from "../../types/utils/logger";

const LEARNING_TTL_MS = 6 * 60 * 60 * 1000;
const LOOKBACK_DAYS = 180;
const MIN_SAMPLES_PREFIX3 = 3;
const MIN_SAMPLES_PREFIX2 = 8;

type LearnedBucket = { days: number; samples: number };

type LearningCache = {
  expiresAt: number;
  byPrefix3: Map<string, LearnedBucket>;
  byPrefix2: Map<string, LearnedBucket>;
};

let cache: LearningCache | null = null;
let inflight: Promise<LearningCache> | null = null;

function calendarDaysBetween(from: Date, to: Date): number {
  const a = Date.UTC(from.getFullYear(), from.getMonth(), from.getDate());
  const b = Date.UTC(to.getFullYear(), to.getMonth(), to.getDate());
  return Math.max(1, Math.round((b - a) / 86_400_000));
}

function historyStamp(
  history: { status?: string; timestamp?: Date }[] | undefined,
  status: string,
): Date | undefined {
  const hit = [...(history || [])]
    .reverse()
    .find((h) => (h.status || "").toLowerCase() === status);
  return hit?.timestamp ? new Date(hit.timestamp) : undefined;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return Math.round((sorted[mid - 1] + sorted[mid]) / 2);
  }
  return sorted[mid];
}

function toBuckets(groups: Map<string, number[]>): Map<string, LearnedBucket> {
  const out = new Map<string, LearnedBucket>();
  for (const [key, days] of groups) {
    if (days.length === 0) continue;
    out.set(key, { days: median(days), samples: days.length });
  }
  return out;
}

async function loadLearningCache(): Promise<LearningCache> {
  if (cache && cache.expiresAt > Date.now()) return cache;
  if (inflight) return inflight;

  inflight = (async () => {
    const since = new Date();
    since.setDate(since.getDate() - LOOKBACK_DAYS);

    const rows = await Order.find({
      status: "delivered",
      "shippingAddress.pincode": { $regex: /^\d{6}$/ },
      $or: [{ deliveredAt: { $gte: since } }, { updatedAt: { $gte: since } }],
    })
      .select("shippingAddress.pincode shippedAt deliveredAt statusHistory createdAt")
      .lean()
      .limit(4000);

    const prefix3 = new Map<string, number[]>();
    const prefix2 = new Map<string, number[]>();

    for (const row of rows) {
      const pin = String(row.shippingAddress?.pincode || "").replace(/\D/g, "");
      if (pin.length !== 6) continue;

      const shipped =
        row.shippedAt ? new Date(row.shippedAt)
        : historyStamp(row.statusHistory, "shipped");
      const delivered =
        row.deliveredAt ? new Date(row.deliveredAt)
        : historyStamp(row.statusHistory, "delivered");
      if (!delivered) continue;

      const start = shipped || (row.createdAt ? new Date(row.createdAt) : null);
      if (!start) continue;

      const days = calendarDaysBetween(start, delivered);
      if (days < 1 || days > 21) continue;

      const p3 = pin.slice(0, 3);
      const p2 = pin.slice(0, 2);
      prefix3.set(p3, [...(prefix3.get(p3) || []), days]);
      prefix2.set(p2, [...(prefix2.get(p2) || []), days]);
    }

    const next: LearningCache = {
      expiresAt: Date.now() + LEARNING_TTL_MS,
      byPrefix3: toBuckets(prefix3),
      byPrefix2: toBuckets(prefix2),
    };
    cache = next;
    return next;
  })()
    .catch((err) => {
      logger.warn({
        msg: "delivery_tat_learning_failed",
        error: err instanceof Error ? err.message : String(err),
      });
      const empty: LearningCache = {
        expiresAt: Date.now() + 15 * 60 * 1000,
        byPrefix3: new Map(),
        byPrefix2: new Map(),
      };
      cache = empty;
      return empty;
    })
    .finally(() => {
      inflight = null;
    });

  return inflight;
}

/** Median door-to-door days from our delivered orders, if enough samples. */
export async function getLearnedTransitDays(
  pincode: string,
): Promise<{ days: number; samples: number; key: string } | null> {
  const pin = pincode.replace(/\D/g, "").slice(0, 6);
  if (pin.length !== 6) return null;

  try {
    const learned = await loadLearningCache();
    const p3 = learned.byPrefix3.get(pin.slice(0, 3));
    if (p3 && p3.samples >= MIN_SAMPLES_PREFIX3) {
      return { days: p3.days, samples: p3.samples, key: pin.slice(0, 3) };
    }
    const p2 = learned.byPrefix2.get(pin.slice(0, 2));
    if (p2 && p2.samples >= MIN_SAMPLES_PREFIX2) {
      return { days: p2.days, samples: p2.samples, key: pin.slice(0, 2) };
    }
    return null;
  } catch {
    return null;
  }
}
