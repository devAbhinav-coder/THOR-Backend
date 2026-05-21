/** Asia/Kolkata boundaries for admin reporting. */
export const IST_TZ = 'Asia/Kolkata';
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

export function istParts(date: Date): { year: number; month: number; day: number } {
  const shifted = new Date(date.getTime() + IST_OFFSET_MS);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth(),
    day: shifted.getUTCDate(),
  };
}

/** monthIdx is 0-based (Jan = 0). */
export function istMidnight(year: number, monthIdx: number, day: number): Date {
  return new Date(Date.UTC(year, monthIdx, day) - IST_OFFSET_MS);
}

export function istEndOfDay(year: number, monthIdx: number, day: number): Date {
  return new Date(istMidnight(year, monthIdx, day + 1).getTime() - 1);
}
