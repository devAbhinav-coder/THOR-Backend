export function normalizeIndianMobile10(raw?: string | null): string | null {
  const d = String(raw ?? "").replace(/\D/g, "");
  let ten = d;
  if (d.length === 12 && d.startsWith("91")) ten = d.slice(2);
  else if (d.length === 11 && d.startsWith("0")) ten = d.slice(1);
  else if (d.length >= 10) ten = d.slice(-10);
  return /^[6-9]\d{9}$/.test(ten) ? ten : null;
}

export function formatIndianMobileDisplay(raw?: string | null): string | null {
  const ten = normalizeIndianMobile10(raw);
  if (!ten) return null;
  return `+91 ${ten.slice(0, 5)} ${ten.slice(5)}`;
}

/** Stable POS lead inbox when offline sale has phone but no real email. */
export function posLeadEmailForPhone(phone10: string): string {
  return `p${phone10}@pos.lead.local`;
}
