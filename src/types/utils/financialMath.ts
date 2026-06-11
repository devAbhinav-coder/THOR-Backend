/**
 * Accounting-safe money math using integer paise (1/100 INR).
 * Produces the same 2-decimal results as the legacy Math.round(x * 100) / 100 paths.
 */

export function toPaise(amount: number): number {
  if (!Number.isFinite(amount)) return 0;
  return Math.round(amount * 100);
}

export function fromPaise(paise: number): number {
  return paise / 100;
}

/** Round to 2 decimal places (legacy-compatible). */
export function roundMoney(amount: number): number {
  return fromPaise(toPaise(amount));
}

export function multiplyMoney(a: number, b: number): number {
  return fromPaise(Math.round(a * b * 100));
}

export function percentOfMoney(base: number, ratePercent: number): number {
  return fromPaise(Math.round((toPaise(base) * ratePercent) / 100));
}

export function splitGstHalves(gstAmount: number): { cgst: number; sgst: number } {
  const half = fromPaise(Math.round(toPaise(gstAmount) / 2));
  const other = fromPaise(toPaise(gstAmount) - toPaise(half));
  return { cgst: half, sgst: other };
}

export interface GstLineCalc {
  taxableAmount: number;
  cgst: number;
  sgst: number;
  igst: number;
  lineTotal: number;
}

export function calcPurchaseLineItem(
  quantity: number,
  unitCost: number,
  gstRate: number,
  supplyType: 'intra' | 'inter'
): GstLineCalc {
  const taxableAmount = multiplyMoney(quantity, unitCost);
  const gstAmount = percentOfMoney(taxableAmount, gstRate);
  if (supplyType === 'intra') {
    const { cgst, sgst } = splitGstHalves(gstAmount);
    return {
      taxableAmount,
      cgst,
      sgst,
      igst: 0,
      lineTotal: fromPaise(toPaise(taxableAmount) + toPaise(gstAmount)),
    };
  }
  return {
    taxableAmount,
    cgst: 0,
    sgst: 0,
    igst: gstAmount,
    lineTotal: fromPaise(toPaise(taxableAmount) + toPaise(gstAmount)),
  };
}

export function sumMoney(values: number[]): number {
  const paise = values.reduce((s, v) => s + toPaise(v), 0);
  return fromPaise(paise);
}
