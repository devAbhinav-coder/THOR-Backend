import { Response, NextFunction } from "express";
import mongoose from "mongoose";
import SalesInvoice, { type ISalesInvoice } from "../models/SalesInvoice";
import Order from "../models/Order";
import AppError from "../types/utils/AppError";
import catchAsync from "../types/utils/catchAsync";
import { sendPaginated, sendSuccess } from "../types/utils/response";
import { writeAdminAudit } from "../services/adminAuditService";
import type { AuthRequest } from "../types";
import {
  computeTotals,
  normalizeBuyer,
  normalizeLines,
  normalizeMeta,
  normalizeSeller,
  type InboundBody,
} from "../utils/salesInvoiceHelpers";
import {
  createTaxInvoiceFromB2bOrder,
  getTaxInvoiceForOrder,
  salesInvoiceToClientShape,
} from "../services/salesInvoice/b2bTaxInvoiceFromOrderService";

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
        { orderNumber: { $regex: safe, $options: "i" } },
        { "buyer.companyName": { $regex: safe, $options: "i" } },
        { "buyer.name": { $regex: safe, $options: "i" } },
        { "buyer.gstin": { $regex: safe, $options: "i" } },
        { "meta.poNumber": { $regex: safe, $options: "i" } },
      ];
    }

    const [items, total] = await Promise.all([
      SalesInvoice.find(filter).sort({ updatedAt: -1 }).skip(skip).limit(limit),
      SalesInvoice.countDocuments(filter),
    ]);

    sendPaginated(
      res,
      { invoices: items.map(salesInvoiceToClientShape) },
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
    sendSuccess(res, { invoice: salesInvoiceToClientShape(doc) });
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

    sendSuccess(res, { invoice: salesInvoiceToClientShape(created) }, "Invoice saved", 201);
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

    sendSuccess(res, { invoice: salesInvoiceToClientShape(updated) }, "Invoice saved");
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

    if (doc.orderId) {
      await Order.updateMany(
        { taxSalesInvoiceId: doc._id },
        { $unset: { taxSalesInvoiceId: 1 } },
      );
    }

    await writeAdminAudit(req, "invoice.deleted", {
      invoiceId: String(doc._id),
      invoiceNumber: doc.invoiceNumber,
    });

    sendSuccess(res, null, "Invoice deleted");
  },
);

/** POST /api/admin/orders/:id/create-tax-invoice */
export const createTaxInvoiceFromOrder = catchAsync(
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    const { id } = req.params;
    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
      return next(new AppError("Invalid order id.", 400));
    }

    const adminId = req.user?._id as mongoose.Types.ObjectId | undefined;
    let created: ISalesInvoice;
    try {
      created = await createTaxInvoiceFromB2bOrder(id, adminId);
    } catch (err) {
      if (err instanceof AppError) return next(err);
      throw err;
    }

    await writeAdminAudit(req, "invoice.created_from_order", {
      invoiceId: String(created._id),
      invoiceNumber: created.invoiceNumber,
      orderId: id,
      orderNumber: created.orderNumber,
      grandTotal: created.grandTotal,
    });

    sendSuccess(
      res,
      { invoice: salesInvoiceToClientShape(created) },
      "Tax invoice created from order",
      201,
    );
  },
);

/** GET /api/admin/orders/:id/tax-invoice */
export const getOrderTaxInvoice = catchAsync(
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    const { id } = req.params;
    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
      return next(new AppError("Invalid order id.", 400));
    }

    const order = await Order.findById(id).select("_id");
    if (!order) return next(new AppError("Order not found.", 404));

    const invoice = await getTaxInvoiceForOrder(id);
    sendSuccess(res, { invoice });
  },
);
