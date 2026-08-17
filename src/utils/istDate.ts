/** Shared IST date helpers for analytics jobs and dashboard. */
export const IST_TZ = "Asia/Kolkata";
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

export function istParts(date: Date): { year: number; month: number; day: number } {
  const shifted = new Date(date.getTime() + IST_OFFSET_MS);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth(),
    day: shifted.getUTCDate(),
  };
}

export function istMidnight(year: number, monthIdx: number, day: number): Date {
  return new Date(Date.UTC(year, monthIdx, day) - IST_OFFSET_MS);
}

export const istDateFormatter = new Intl.DateTimeFormat("sv-SE", {
  timeZone: IST_TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

export function formatIstDate(date: Date): string {
  return istDateFormatter.format(date);
}

/** Completed IST calendar day bounds (start inclusive, end exclusive). */
export function istDayBounds(dateKey: string): { start: Date; end: Date } {
  const anchor = new Date(`${dateKey}T12:00:00+05:30`);
  const ist = istParts(anchor);
  const start = istMidnight(ist.year, ist.month, ist.day);
  const end = new Date(start.getTime() + 86400000);
  return { start, end };
}

/** Yesterday's IST date key and UTC bounds for aggregation. */
export function istYesterdayWindow(now = new Date()): {
  dateKey: string;
  start: Date;
  end: Date;
} {
  const ist = istParts(now);
  const start = istMidnight(ist.year, ist.month, ist.day - 1);
  const end = istMidnight(ist.year, ist.month, ist.day);
  const dateKey = formatIstDate(new Date(start.getTime() + 12 * 60 * 60 * 1000));
  return { dateKey, start, end };
}
