import { Response, NextFunction } from "express";
import mongoose from "mongoose";
import SalesInvoice, {
  type ISalesInvoice,
  type ISalesInvoiceLine,
  type SalesInvoiceTaxMode,
} from "../models/SalesInvoice";
import AppError from "../utils/AppError";
import catchAsync from "../utils/catchAsync";
import { sendPaginated, sendSuccess } from "../utils/response";
import { writeAdminAudit } from "../services/adminAuditService";
import type { AuthRequest } from "../types";

/* ── Server-side totals (single source of truth) ─────────────────────── */

function safeNum(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function clampPct(n: number): number {
  return Math.min(100, Math.max(0, n));
}

type ComputedRow = {
  taxable: number;
  discountAmt: number;
  gstAmt: number;
};

function computeRow(line: ISalesInvoiceLine): ComputedRow {
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

function computeTotals(
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

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/* ── Payload normalisation (defensive — clamps lengths, coerces numbers) ── */

type InboundLine = Partial<ISalesInvoiceLine>;
type InboundSeller = Partial<ISalesInvoice["seller"]>;
type InboundBuyer = Partial<ISalesInvoice["buyer"]>;
type InboundMeta = Partial<ISalesInvoice["meta"]>;

type InboundBody = {
  seller?: InboundSeller;
  buyer?: InboundBuyer;
  meta?: InboundMeta;
  lines?: InboundLine[];
};

function strField(raw: unknown, max: number): string {
  if (typeof raw !== "string") return "";
  return raw.trim().slice(0, max);
}

function normalizeLines(raw: unknown): ISalesInvoiceLine[] {
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

function normalizeSeller(raw: unknown): ISalesInvoice["seller"] {
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

function normalizeBuyer(raw: unknown): ISalesInvoice["buyer"] {
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

function normalizeMeta(raw: unknown): ISalesInvoice["meta"] {
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

/* ── Serialization ────────────────────────────────────────────────────── */

function toClientShape(doc: ISalesInvoice) {
  return {
    id: String(doc._id),
    updatedAt: doc.updatedAt.toISOString(),
    createdAt: doc.createdAt.toISOString(),
    invoiceNumber: doc.invoiceNumber,
    invoiceDate: doc.invoiceDate,
    taxMode: doc.taxMode,
    itemCount: doc.itemCount,
    grandTotal: doc.grandTotal,
    subTotal: doc.subTotal,
    totalDiscount: doc.totalDiscount,
    totalGst: doc.totalGst,
    seller: doc.seller,
    buyer: doc.buyer,
    meta: doc.meta,
    lines: doc.lines,
  };
}

/* ── Handlers ─────────────────────────────────────────────────────────── */

/** GET /api/admin/invoices */
export const listSalesInvoices = catchAsync(
  async (req: AuthRequest, res: Response) => {
    const page = Math.max(1, parseInt(String(req.query.page || "1"), 10) || 1);
    const limit = Math.min(
      100,
      Math.max(1, parseInt(String(req.query.limit || "50"), 10) || 50),
    );
    const skip = (page - 1) * limit;
    const search = String(req.query.search || "").trim();

    const filter: Record<string, unknown> = {};
    if (search) {
      const safe = search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      filter.$or = [
        { invoiceNumber: { $regex: safe, $options: "i" } },
        { "buyer.companyName": { $regex: safe, $options: "i" } },
        { "buyer.name": { $regex: safe, $options: "i" } },
        { "buyer.gstin": { $regex: safe, $options: "i" } },
        { "meta.poNumber": { $regex: safe, $options: "i" } },
      ];
    }

    const [items, total] = await Promise.all([
      SalesInvoice.find(filter)
        .sort({ updatedAt: -1 })
        .skip(skip)
        .limit(limit),
      SalesInvoice.countDocuments(filter),
    ]);

    sendPaginated(
      res,
      { invoices: items.map(toClientShape) },
      { page, limit, total },
      "OK",
    );
  },
);

/** GET /api/admin/invoices/:id */
export const getSalesInvoice = catchAsync(
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    const { id } = req.params;
    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
      return next(new AppError("Invalid invoice id.", 400));
    }
    const doc = await SalesInvoice.findById(id);
    if (!doc) return next(new AppError("Invoice not found.", 404));
    sendSuccess(res, { invoice: toClientShape(doc) });
  },
);

/** POST /api/admin/invoices */
export const createSalesInvoice = catchAsync(
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    const body = (req.body || {}) as InboundBody;
    const seller = normalizeSeller(body.seller);
    const buyer = normalizeBuyer(body.buyer);
    const meta = normalizeMeta(body.meta);
    const lines = normalizeLines(body.lines);

    if (!meta.invoiceNumber)
      return next(new AppError("Invoice number is required.", 400));
    if (!meta.invoiceDate)
      return next(new AppError("Invoice date is required.", 400));
    if (lines.length === 0) {
      return next(new AppError("Add at least one line item.", 400));
    }

    const totals = computeTotals(lines, meta.taxMode);
    const adminId = req.user?._id as mongoose.Types.ObjectId | undefined;

    let created: ISalesInvoice;
    try {
      created = await SalesInvoice.create({
        invoiceNumber: meta.invoiceNumber,
        invoiceDate: meta.invoiceDate,
        taxMode: meta.taxMode,
        itemCount: lines.length,
        ...totals,
        seller,
        buyer,
        meta,
        lines,
        createdBy: adminId,
      });
    } catch (err: unknown) {
      const code = (err as { code?: number })?.code;
      if (code === 11000) {
        return next(
          new AppError(
            `Invoice number "${meta.invoiceNumber}" already exists. Pick a different number.`,
            409,
          ),
        );
      }
      throw err;
    }

    await writeAdminAudit(req, "invoice.created", {
      invoiceId: String(created._id),
      invoiceNumber: created.invoiceNumber,
      grandTotal: created.grandTotal,
    });

    sendSuccess(res, { invoice: toClientShape(created) }, "Invoice saved", 201);
  },
);

/** PUT /api/admin/invoices/:id */
export const updateSalesInvoice = catchAsync(
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    const { id } = req.params;
    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
      return next(new AppError("Invalid invoice id.", 400));
    }
    const body = (req.body || {}) as InboundBody;
    const seller = normalizeSeller(body.seller);
    const buyer = normalizeBuyer(body.buyer);
    const meta = normalizeMeta(body.meta);
    const lines = normalizeLines(body.lines);

    if (!meta.invoiceNumber)
      return next(new AppError("Invoice number is required.", 400));
    if (!meta.invoiceDate)
      return next(new AppError("Invoice date is required.", 400));
    if (lines.length === 0) {
      return next(new AppError("Add at least one line item.", 400));
    }

    const totals = computeTotals(lines, meta.taxMode);
    let updated: ISalesInvoice | null;
    try {
      updated = await SalesInvoice.findByIdAndUpdate(
        id,
        {
          $set: {
            invoiceNumber: meta.invoiceNumber,
            invoiceDate: meta.invoiceDate,
            taxMode: meta.taxMode,
            itemCount: lines.length,
            ...totals,
            seller,
            buyer,
            meta,
            lines,
          },
        },
        { new: true, runValidators: true },
      );
    } catch (err: unknown) {
      const code = (err as { code?: number })?.code;
      if (code === 11000) {
        return next(
          new AppError(
            `Invoice number "${meta.invoiceNumber}" already exists. Pick a different number.`,
            409,
          ),
        );
      }
      throw err;
    }
    if (!updated) return next(new AppError("Invoice not found.", 404));

    await writeAdminAudit(req, "invoice.updated", {
      invoiceId: String(updated._id),
      invoiceNumber: updated.invoiceNumber,
      grandTotal: updated.grandTotal,
    });

    sendSuccess(res, { invoice: toClientShape(updated) }, "Invoice saved");
  },
);

/** DELETE /api/admin/invoices/:id */
export const deleteSalesInvoice = catchAsync(
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    const { id } = req.params;
    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
      return next(new AppError("Invalid invoice id.", 400));
    }
    const doc = await SalesInvoice.findByIdAndDelete(id);
    if (!doc) return next(new AppError("Invoice not found.", 404));

    await writeAdminAudit(req, "invoice.deleted", {
      invoiceId: String(doc._id),
      invoiceNumber: doc.invoiceNumber,
    });

    sendSuccess(res, null, "Invoice deleted");
  },
);
