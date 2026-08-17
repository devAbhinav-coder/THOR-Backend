import type {
  ISalesInvoice,
  ISalesInvoiceLine,
  SalesInvoiceTaxMode,
} from "../models/SalesInvoice";

export function safeNum(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

export function clampPct(n: number): number {
  return Math.min(100, Math.max(0, n));
}

type ComputedRow = {
  taxable: number;
  discountAmt: number;
  gstAmt: number;
};

export function computeRow(line: ISalesInvoiceLine): ComputedRow {
  const qty = Math.max(0, safeNum(line.qty));
  const rate = Math.max(0, safeNum(line.rate));
  const discountPct = clampPct(safeNum(line.discountPct));
  const gstPct = clampPct(safeNum(line.gstPct));

  const gross = qty * rate;
  const discountAmt = (gross * discountPct) / 100;
  const taxable = gross - discountAmt;
  const gstAmt = (taxable * gstPct) / 100;
  return { taxable, discountAmt, gstAmt };
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function computeTotals(
  lines: ISalesInvoiceLine[],
  taxMode: SalesInvoiceTaxMode,
): {
  subTotal: number;
  totalDiscount: number;
  totalGst: number;
  grandTotal: number;
} {
  let subTotal = 0;
  let totalDiscount = 0;
  let totalGst = 0;
  for (const l of lines) {
    const c = computeRow(l);
    subTotal += c.taxable;
    totalDiscount += c.discountAmt;
    totalGst += c.gstAmt;
  }
  const effectiveGst = taxMode === "none" ? 0 : totalGst;
  const grandTotal = Math.round(subTotal + effectiveGst);
  return {
    subTotal: round2(subTotal),
    totalDiscount: round2(totalDiscount),
    totalGst: round2(effectiveGst),
    grandTotal,
  };
}

type InboundLine = Partial<ISalesInvoiceLine>;
type InboundSeller = Partial<ISalesInvoice["seller"]>;
type InboundBuyer = Partial<ISalesInvoice["buyer"]>;
type InboundMeta = Partial<ISalesInvoice["meta"]>;

export type InboundBody = {
  seller?: InboundSeller;
  buyer?: InboundBuyer;
  meta?: InboundMeta;
  lines?: InboundLine[];
};

export function strField(raw: unknown, max: number): string {
  if (typeof raw !== "string") return "";
  return raw.trim().slice(0, max);
}

export function normalizeLines(raw: unknown): ISalesInvoiceLine[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((x): x is InboundLine => typeof x === "object" && x !== null)
    .slice(0, 200)
    .map<ISalesInvoiceLine>((line) => {
      const unitRaw = strField(line.unit, 30) as ISalesInvoiceLine["unit"];
      const validUnits: ISalesInvoiceLine["unit"][] = [
        "pcs",
        "mtr",
        "kg",
        "gm",
        "ltr",
        "set",
        "box",
        "pkt",
        "dozen",
        "hr",
        "day",
        "custom",
      ];
      const unit = validUnits.includes(unitRaw) ? unitRaw : "pcs";
      return {
        description: strField(line.description, 500),
        hsn: strField(line.hsn, 20),
        unit,
        customUnit: strField(line.customUnit, 30),
        qty: Math.max(0, safeNum(line.qty)),
        rate: Math.max(0, safeNum(line.rate)),
        discountPct: clampPct(safeNum(line.discountPct)),
        gstPct: clampPct(safeNum(line.gstPct)),
      };
    });
}

export function normalizeSeller(raw: unknown): ISalesInvoice["seller"] {
  const r = (raw && typeof raw === "object" ? raw : {}) as InboundSeller;
  return {
    name: strField(r.name, 200) || "Seller",
    address: strField(r.address, 500),
    email: strField(r.email, 200),
    phone: strField(r.phone, 30),
    gstin: strField(r.gstin, 20).toUpperCase(),
    pan: strField(r.pan, 20).toUpperCase(),
    state: strField(r.state, 80),
  };
}

export function normalizeBuyer(raw: unknown): ISalesInvoice["buyer"] {
  const r = (raw && typeof raw === "object" ? raw : {}) as InboundBuyer;
  return {
    name: strField(r.name, 200),
    companyName: strField(r.companyName, 200),
    gstin: strField(r.gstin, 20).toUpperCase(),
    pan: strField(r.pan, 20).toUpperCase(),
    address: strField(r.address, 500),
    state: strField(r.state, 80),
    phone: strField(r.phone, 30),
    email: strField(r.email, 200),
  };
}

export function normalizeMeta(raw: unknown): ISalesInvoice["meta"] {
  const r = (raw && typeof raw === "object" ? raw : {}) as InboundMeta;
  const taxMode: SalesInvoiceTaxMode =
    r.taxMode === "igst" || r.taxMode === "none" ? r.taxMode : "cgst_sgst";
  return {
    invoiceNumber: strField(r.invoiceNumber, 60),
    invoiceDate: strField(r.invoiceDate, 20),
    dueDate: strField(r.dueDate, 20),
    poNumber: strField(r.poNumber, 80),
    notes: strField(r.notes, 2000),
    terms: strField(r.terms, 2000),
    taxMode,
    showHsn: r.showHsn !== false,
    showDiscount: r.showDiscount !== false,
    showGstColumn: r.showGstColumn !== false,
  };
}

import { suggestB2bTaxInvoiceNumber } from "./documentNumbers";

export function suggestInvoiceNumber(now: Date = new Date()): string {
  return suggestB2bTaxInvoiceNumber(now);
}

export function todayIsoDate(now: Date = new Date()): string {
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

export const DEFAULT_SALES_INVOICE_SELLER: ISalesInvoice["seller"] = {
  name: "The House of Rani",
  address: "Amrapali Princely State Sector 76, Noida, Uttar Pradesh 201301",
  email: "support@thehouseofrani.com",
  phone: "+91 8340311033",
  gstin: "10CCLPR1131E1Z6",
  state: "Uttar Pradesh",
  pan: "",
};

export const DEFAULT_SALES_INVOICE_TERMS =
  "1. Payment due within the agreed terms.\n2. Goods once sold will be returned only as per our return policy.\n3. Subject to Noida jurisdiction.";
