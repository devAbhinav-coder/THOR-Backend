import { Types } from 'mongoose';
import PurchaseInvoice from '../../models/PurchaseInvoice';
import AppError from '../../utils/AppError';
import { runInTransaction } from '../../utils/mongoTransaction';
import { calcPurchaseLineItem, roundMoney, sumMoney } from '../../utils/financialMath';
import { getRequestContext } from '../../utils/requestContext';
import logger from '../../utils/logger';
import { writeAdminAudit } from '../adminAuditService';
import { schedulePdpInvalidationForProductId } from '../productCacheService';
import { AuthRequest } from '../../types';
import {
  executeStockIncrements,
  readVariantStockAfter,
  type StockIncrementOp,
} from './stockBulkService';
import { insertLedgerEntries } from './stockLedgerService';
import { scheduleInventorySummaryInvalidation } from './inventoryCacheService';
import { recordInventoryMetric } from './inventoryMetricsService';
import { INVENTORY_QUERY_MAX_MS } from '../../constants/inventoryQuery';

export interface PurchaseLineInput {
  product?: string;
  productName: string;
  sku: string;
  variantLabel?: string;
  quantity: number;
  unitCost: number;
  hsn?: string;
  gstRate?: number;
}

export interface CreatePurchaseInvoiceInput {
  invoiceNumber: string;
  supplierName: string;
  supplierGstin?: string;
  supplyType?: 'intra' | 'inter';
  invoiceDate: string;
  lineItems: PurchaseLineInput[];
  paymentStatus?: 'unpaid' | 'paid' | 'partial';
  paidAmount?: number;
  notes?: string;
  updateCostPrice?: boolean;
  idempotencyKey?: string;
}

function escapeRegex(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function processLineItems(
  lineItems: PurchaseLineInput[],
  supplyType: 'intra' | 'inter'
) {
  return lineItems.map((li) => {
    const gstRate = Number(li.gstRate ?? 0);
    const calc = calcPurchaseLineItem(li.quantity, li.unitCost, gstRate, supplyType);
    return {
      product: li.product && Types.ObjectId.isValid(li.product) ? li.product : undefined,
      productName: li.productName.trim(),
      sku: li.sku.trim(),
      variantLabel: li.variantLabel?.trim(),
      quantity: li.quantity,
      unitCost: li.unitCost,
      hsn: li.hsn?.trim(),
      gstRate,
      ...calc,
    };
  });
}

function invoiceTotals(processedLines: ReturnType<typeof processLineItems>) {
  const totalTaxable = sumMoney(processedLines.map((l) => l.taxableAmount));
  const totalCgst = sumMoney(processedLines.map((l) => l.cgst));
  const totalSgst = sumMoney(processedLines.map((l) => l.sgst));
  const totalIgst = sumMoney(processedLines.map((l) => l.igst));
  const totalTax = sumMoney([totalCgst, totalSgst, totalIgst]);
  const grandTotal = sumMoney([totalTaxable, totalTax]);
  return {
    totalTaxable: roundMoney(totalTaxable),
    totalCgst: roundMoney(totalCgst),
    totalSgst: roundMoney(totalSgst),
    totalIgst: roundMoney(totalIgst),
    totalTax: roundMoney(totalTax),
    grandTotal: roundMoney(grandTotal),
  };
}

export async function listPurchaseInvoices(params: {
  page: number;
  limit: number;
  search?: string;
  paymentStatus?: string;
  from?: string;
  to?: string;
}) {
  const skip = (params.page - 1) * params.limit;
  const filter: Record<string, unknown> = { status: { $ne: 'voided' } };

  if (params.search) {
    const escapedSearch = escapeRegex(params.search);
    filter.$or = [
      { supplierName: { $regex: escapedSearch, $options: 'i' } },
      { invoiceNumber: { $regex: escapedSearch, $options: 'i' } },
      { supplierGstin: { $regex: escapedSearch, $options: 'i' } },
    ];
  }
  if (params.paymentStatus) filter.paymentStatus = params.paymentStatus;
  if (params.from || params.to) {
    const dateFilter: Record<string, Date> = {};
    if (params.from) dateFilter.$gte = new Date(params.from);
    if (params.to) dateFilter.$lte = new Date(params.to);
    filter.invoiceDate = dateFilter;
  }

  const [invoices, total] = await Promise.all([
    PurchaseInvoice.find(filter)
      .sort('-invoiceDate')
      .skip(skip)
      .limit(params.limit)
      .populate('createdBy', 'name email')
      .lean()
      .maxTimeMS(INVENTORY_QUERY_MAX_MS),
    PurchaseInvoice.countDocuments(filter).maxTimeMS(INVENTORY_QUERY_MAX_MS),
  ]);

  return { invoices, total };
}

export async function getPurchaseInvoiceById(id: string) {
  if (!Types.ObjectId.isValid(id)) return null;
  const inv = await PurchaseInvoice.findOne({ _id: id, status: { $ne: 'voided' } })
    .populate('createdBy', 'name email')
    .lean()
    .maxTimeMS(INVENTORY_QUERY_MAX_MS);
  return inv;
}

export async function createPurchaseInvoice(req: AuthRequest, body: CreatePurchaseInvoiceInput) {
  const ctx = getRequestContext();
  const idempotencyKey = body.idempotencyKey?.trim();

  if (idempotencyKey) {
    const existing = await PurchaseInvoice.findOne({
      idempotencyKey,
      status: { $ne: 'voided' },
    }).lean();
    if (existing) {
      recordInventoryMetric('inventory.purchase_invoice.duplicate', { phase: 'idempotency' });
      return existing;
    }
  }

  const duplicateNumber = await PurchaseInvoice.exists({
    invoiceNumber: body.invoiceNumber.trim(),
    status: { $ne: 'voided' },
  });
  if (duplicateNumber) {
    recordInventoryMetric('inventory.purchase_invoice.duplicate', { phase: 'invoice_number' });
    throw new AppError('A purchase invoice with this invoice number already exists.', 409);
  }

  const supplyType = body.supplyType ?? 'intra';
  const processedLines = processLineItems(body.lineItems, supplyType);
  const totals = invoiceTotals(processedLines);

  try {
    const invoice = await runInTransaction(async (session) => {
      const created = await PurchaseInvoice.create(
        [
          {
            invoiceNumber: body.invoiceNumber.trim(),
            supplierName: body.supplierName.trim(),
            supplierGstin: body.supplierGstin?.trim() || undefined,
            supplyType,
            invoiceDate: new Date(body.invoiceDate),
            lineItems: processedLines,
            ...totals,
            paymentStatus: body.paymentStatus ?? 'unpaid',
            paidAmount: body.paidAmount ?? 0,
            notes: body.notes?.trim(),
            createdBy: req.user?._id,
            status: 'active',
            idempotencyKey: idempotencyKey || undefined,
          },
        ],
        { session }
      );
      const invoiceDoc = created[0]!;

      const stockOps: StockIncrementOp[] = [];
      for (const li of processedLines) {
        if (li.product && li.sku && li.quantity > 0) {
          stockOps.push({
            productId: li.product,
            sku: li.sku,
            quantity: li.quantity,
            unitCost: li.unitCost,
            updateCostPrice: body.updateCostPrice !== false,
          });
        }
      }

      await executeStockIncrements(stockOps, session);

      const ledgerEntries = [];
      for (const li of processedLines) {
        if (li.product && li.sku && li.quantity > 0) {
          const stockAfter = await readVariantStockAfter(li.product, li.sku, session);
          ledgerEntries.push({
            product: li.product,
            sku: li.sku,
            productName: li.productName,
            variantLabel: li.variantLabel,
            delta: li.quantity,
            stockAfter,
            reason: 'purchase' as const,
            referenceId: String(invoiceDoc._id),
            referenceType: 'purchase_invoice' as const,
            actor: req.user?._id,
            note: `Purchase invoice ${body.invoiceNumber.trim()}`,
          });
        }
      }

      if (ledgerEntries.length > 0) {
        await insertLedgerEntries(ledgerEntries, session);
      }

      return invoiceDoc;
    }, 'inventory.purchase_invoice.create');

    const productIds = [
      ...new Set(processedLines.map((li) => li.product).filter((id): id is string => Boolean(id))),
    ];
    for (const pid of productIds) {
      schedulePdpInvalidationForProductId(pid);
    }

    await writeAdminAudit(req, 'inventory.purchase_invoice.created', {
      invoiceId: String(invoice._id),
      invoiceNumber: invoice.invoiceNumber,
      grandTotal: invoice.grandTotal,
    });

    recordInventoryMetric('inventory.purchase_invoice.created', {
      invoiceId: String(invoice._id),
      requestId: ctx?.requestId,
    });

    scheduleInventorySummaryInvalidation();

    logger.info({
      msg: 'inventory_purchase_invoice_created',
      requestId: ctx?.requestId,
      invoiceId: String(invoice._id),
      invoiceNumber: invoice.invoiceNumber,
      actorId: req.user?._id ? String(req.user._id) : undefined,
    });

    return invoice;
  } catch (err: unknown) {
    recordInventoryMetric('inventory.purchase_invoice.failed', { requestId: ctx?.requestId });
    if (err instanceof Error && /duplicate key/i.test(err.message)) {
      throw new AppError('A purchase invoice with this invoice number already exists.', 409);
    }
    throw err;
  }
}

export async function updatePurchaseInvoice(
  req: AuthRequest,
  id: string,
  body: Partial<{
    invoiceNumber: string;
    supplierName: string;
    supplierGstin: string;
    supplyType: 'intra' | 'inter';
    invoiceDate: string;
    paymentStatus: 'unpaid' | 'paid' | 'partial';
    paidAmount: number;
    notes: string;
  }>
) {
  const inv = await PurchaseInvoice.findOne({ _id: id, status: { $ne: 'voided' } });
  if (!inv) throw new AppError('Purchase invoice not found.', 404);

  if (body.invoiceNumber && body.invoiceNumber.trim() !== inv.invoiceNumber) {
    const clash = await PurchaseInvoice.exists({
      invoiceNumber: body.invoiceNumber.trim(),
      status: { $ne: 'voided' },
      _id: { $ne: id },
    });
    if (clash) throw new AppError('A purchase invoice with this invoice number already exists.', 409);
    inv.invoiceNumber = body.invoiceNumber.trim();
  }
  if (body.supplierName) inv.supplierName = body.supplierName.trim();
  if (body.supplierGstin !== undefined) inv.supplierGstin = body.supplierGstin.trim() || undefined;
  if (body.supplyType) inv.supplyType = body.supplyType;
  if (body.invoiceDate) inv.invoiceDate = new Date(body.invoiceDate);
  if (body.paymentStatus) inv.paymentStatus = body.paymentStatus;
  if (body.paidAmount !== undefined) inv.paidAmount = body.paidAmount;
  if (body.notes !== undefined) inv.notes = body.notes.trim();

  await inv.save();
  await writeAdminAudit(req, 'inventory.purchase_invoice.updated', { invoiceId: String(inv._id) });
  return inv;
}

/** Soft-void: preserves audit trail; does not reverse stock (matches legacy hard-delete semantics). */
export async function voidPurchaseInvoice(req: AuthRequest, id: string): Promise<void> {
  const inv = await PurchaseInvoice.findOne({ _id: id, status: { $ne: 'voided' } });
  if (!inv) throw new AppError('Purchase invoice not found.', 404);

  inv.status = 'voided';
  inv.voidedAt = new Date();
  inv.voidedBy = req.user?._id;
  await inv.save();

  await writeAdminAudit(req, 'inventory.purchase_invoice.deleted', {
    invoiceId: id,
    invoiceNumber: inv.invoiceNumber,
    voided: true,
  });

  scheduleInventorySummaryInvalidation();
}
