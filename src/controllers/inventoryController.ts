import { Request, Response, NextFunction } from 'express';
import { AuthRequest } from '../types';
import AppError from '../utils/AppError';
import catchAsync from '../utils/catchAsync';
import { sendPaginated, sendSuccess } from '../utils/response';
import { normalizeIdempotencyKey } from '../services/checkoutConcurrency';
import { adjustVariantStock } from '../services/inventory/inventoryAdjustmentService';
import {
  createPurchaseInvoice,
  getPurchaseInvoiceById,
  listPurchaseInvoices,
  updatePurchaseInvoice,
  voidPurchaseInvoice,
} from '../services/inventory/purchaseInvoiceService';
import { listStockLedger } from '../services/inventory/stockLedgerService';
import {
  getGstPurchaseSummary as fetchGstPurchaseSummary,
  getInventoryOverview,
  getInventoryValuation,
} from '../services/inventory/inventoryReportService';
import { enqueueInventorySideEffect } from '../services/inventory/inventoryOutboxService';

/** GET /admin/inventory */
export const getInventoryOverviewHandler = catchAsync(async (req: Request, res: Response) => {
  const page = Math.max(1, parseInt((req.query.page as string) || '1', 10));
  const limit = Math.min(100, Math.max(1, parseInt((req.query.limit as string) || '20', 10)));

  const { products, summary, total } = await getInventoryOverview({
    page,
    limit,
    search: String(req.query.search || ''),
    category: String(req.query.category || ''),
    filter: String(req.query.filter || 'all'),
    sort: String(req.query.sort || '-updatedAt'),
  });

  sendPaginated(res, { products, summary }, { page, limit, total });
});

/** PATCH /admin/inventory/products/:id/variants/:sku/stock */
export const adjustVariantStockHandler = catchAsync(
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    const { id, sku } = req.params;
    const { delta, reason, note, costPrice, price } = req.body as {
      delta?: number;
      reason: string;
      note?: string;
      costPrice?: number;
      price?: number;
    };

    try {
      const product = await adjustVariantStock(req, {
        productId: id,
        sku,
        delta,
        reason,
        note,
        costPrice,
        price,
      });
      sendSuccess(res, { product }, 'Stock adjusted successfully.');
    } catch (err) {
      next(err);
    }
  }
);

/** GET /admin/inventory/ledger */
export const getStockLedger = catchAsync(async (req: Request, res: Response) => {
  const page = Math.max(1, parseInt((req.query.page as string) || '1', 10));
  const limit = Math.min(100, Math.max(1, parseInt((req.query.limit as string) || '30', 10)));

  const { entries, total } = await listStockLedger({
    page,
    limit,
    productId: String(req.query.product || '').trim() || undefined,
    sku: String(req.query.sku || '').trim() || undefined,
    reason: String(req.query.reason || '').trim() || undefined,
    from: String(req.query.from || '').trim() || undefined,
    to: String(req.query.to || '').trim() || undefined,
  });

  sendPaginated(res, { entries }, { page, limit, total });
});

/** GET /admin/inventory/valuation */
export const getInventoryValuationHandler = catchAsync(async (_req: Request, res: Response) => {
  const data = await getInventoryValuation();
  sendSuccess(res, data);
});

/** GET /admin/inventory/purchase-invoices */
export const listPurchaseInvoicesHandler = catchAsync(async (req: Request, res: Response) => {
  const page = Math.max(1, parseInt((req.query.page as string) || '1', 10));
  const limit = Math.min(100, Math.max(1, parseInt((req.query.limit as string) || '20', 10)));

  const { invoices, total } = await listPurchaseInvoices({
    page,
    limit,
    search: String(req.query.search || ''),
    paymentStatus: String(req.query.paymentStatus || '').trim() || undefined,
    from: String(req.query.from || '').trim() || undefined,
    to: String(req.query.to || '').trim() || undefined,
  });

  sendPaginated(res, { invoices }, { page, limit, total });
});

/** GET /admin/inventory/purchase-invoices/:id */
export const getPurchaseInvoice = catchAsync(async (req: Request, res: Response, next: NextFunction) => {
  const inv = await getPurchaseInvoiceById(req.params.id);
  if (!inv) return next(new AppError('Purchase invoice not found.', 404));
  sendSuccess(res, { invoice: inv });
});

/** POST /admin/inventory/purchase-invoices */
export const createPurchaseInvoiceHandler = catchAsync(
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    const body = req.body as Parameters<typeof createPurchaseInvoice>[1];
    if (!body.lineItems?.length) return next(new AppError('At least one line item is required.', 400));

    const idempotencyKey =
      normalizeIdempotencyKey(req.headers['idempotency-key'] as string | undefined) ?? undefined;

    const invoice = await createPurchaseInvoice(req, { ...body, idempotencyKey });

    void enqueueInventorySideEffect(
      'invalidate_summary',
      {},
      `summary:${String(invoice._id)}`
    );

    sendSuccess(res, { invoice }, 'Purchase invoice created.', 201);
  }
);

/** PUT /admin/inventory/purchase-invoices/:id */
export const updatePurchaseInvoiceHandler = catchAsync(
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const inv = await updatePurchaseInvoice(req, req.params.id, req.body);
      sendSuccess(res, { invoice: inv });
    } catch (err) {
      next(err);
    }
  }
);

/** DELETE /admin/inventory/purchase-invoices/:id — soft-void (audit-safe, same API contract). */
export const deletePurchaseInvoice = catchAsync(
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      await voidPurchaseInvoice(req, req.params.id);
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  }
);

/** GET /admin/inventory/gst-summary */
export const getGstPurchaseSummary = catchAsync(async (req: Request, res: Response) => {
  const year = parseInt((req.query.year as string) || String(new Date().getFullYear()), 10);
  const data = await fetchGstPurchaseSummary({
    year,
    month: req.query.month as string | undefined,
    quarter: req.query.quarter as string | undefined,
  });
  sendSuccess(res, data);
});

// Legacy export names used by adminRoutes
export {
  getInventoryOverviewHandler as getInventoryOverview,
  adjustVariantStockHandler as adjustVariantStock,
  getInventoryValuationHandler as getInventoryValuation,
  listPurchaseInvoicesHandler as listPurchaseInvoices,
  createPurchaseInvoiceHandler as createPurchaseInvoice,
  updatePurchaseInvoiceHandler as updatePurchaseInvoice,
};
