import { Request, Response, NextFunction } from 'express';
import { Types } from 'mongoose';
import { AuthRequest } from '../types';
import Product from '../models/Product';
import StockLedger from '../models/StockLedger';
import PurchaseInvoice from '../models/PurchaseInvoice';
import AppError from '../utils/AppError';
import catchAsync from '../utils/catchAsync';
import { sendPaginated, sendSuccess } from '../utils/response';
import { incrementVariantStock, logStockMovement } from '../services/inventoryService';
import { writeAdminAudit } from '../services/adminAuditService';
import { LOW_STOCK_ALERT_EXCLUSIVE_MAX } from '../constants/inventory';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function calcLineItem(
  quantity: number,
  unitCost: number,
  gstRate: number,
  supplyType: 'intra' | 'inter'
) {
  const taxableAmount = Math.round(quantity * unitCost * 100) / 100;
  const gstAmount = Math.round((taxableAmount * gstRate) / 100 * 100) / 100;
  const cgst = supplyType === 'intra' ? Math.round(gstAmount / 2 * 100) / 100 : 0;
  const sgst = supplyType === 'intra' ? Math.round(gstAmount / 2 * 100) / 100 : 0;
  const igst = supplyType === 'inter' ? gstAmount : 0;
  const lineTotal = taxableAmount + gstAmount;
  return { taxableAmount, cgst, sgst, igst, lineTotal };
}

// ─── Stock Overview ──────────────────────────────────────────────────────────

/** GET /admin/inventory
 *  Paginated product+variant stock table.
 *  Query: page, limit, search, category, filter (all|low|out), sort (name|stock|category)
 */
export const getInventoryOverview = catchAsync(async (req: Request, res: Response) => {
  const page = Math.max(1, parseInt((req.query.page as string) || '1', 10));
  const limit = Math.min(100, Math.max(1, parseInt((req.query.limit as string) || '20', 10)));
  const skip = (page - 1) * limit;
  const search = String(req.query.search || '').trim();
  const category = String(req.query.category || '').trim();
  const filter = String(req.query.filter || 'all');
  const sortParam = String(req.query.sort || '-updatedAt');

  const match: Record<string, unknown> = { isActive: true };
  if (search) {
    match.$or = [
      { name: { $regex: search, $options: 'i' } },
      { 'variants.sku': { $regex: search, $options: 'i' } },
      { category: { $regex: search, $options: 'i' } },
    ];
  }
  if (category) match.category = category;
  if (filter === 'low') {
    match.totalStock = { $gt: 0, $lt: LOW_STOCK_ALERT_EXCLUSIVE_MAX };
  } else if (filter === 'out') {
    match.totalStock = 0;
  }

  const sortMap: Record<string, Record<string, 1 | -1>> = {
    name: { name: 1 },
    '-name': { name: -1 },
    stock: { totalStock: 1 },
    '-stock': { totalStock: -1 },
    category: { category: 1 },
    '-updatedAt': { updatedAt: -1 },
    updatedAt: { updatedAt: 1 },
  };
  const sort = sortMap[sortParam] || { updatedAt: -1 };

  const [products, total] = await Promise.all([
    Product.find(match)
      .sort(sort)
      .skip(skip)
      .limit(limit)
      .select('name category fabric images variants totalStock soldCount price updatedAt hsnCode')
      .lean(),
    Product.countDocuments(match),
  ]);

  const productsWithTurnover = products.map(p => ({
    ...p,
    turnover: p.totalStock > 0 ? (p.soldCount / p.totalStock) : (p.soldCount > 0 ? 99 : 0)
  }));

  // Summary stats
  const [stockStats] = await Product.aggregate([
    { $match: { isActive: true } },
    {
      $addFields: {
        computedTotal: { $sum: '$variants.stock' },
        inventoryValue: {
          $sum: {
            $map: {
              input: '$variants',
              as: 'v',
              in: { $multiply: [{ $ifNull: ['$$v.costPrice', 0] }, '$$v.stock'] },
            },
          },
        },
      },
    },
    {
      $group: {
        _id: null,
        totalProducts: { $sum: 1 },
        totalUnits: { $sum: '$computedTotal' },
        outOfStock: { $sum: { $cond: [{ $eq: ['$computedTotal', 0] }, 1, 0] } },
        lowStock: {
          $sum: {
            $cond: [
              { $and: [{ $gt: ['$computedTotal', 0] }, { $lt: ['$computedTotal', LOW_STOCK_ALERT_EXCLUSIVE_MAX] }] },
              1,
              0,
            ],
          },
        },
        totalInventoryValue: { $sum: '$inventoryValue' },
      },
    },
  ]);

  sendPaginated(
    res,
    { products: productsWithTurnover, summary: stockStats || { totalProducts: 0, totalUnits: 0, outOfStock: 0, lowStock: 0, totalInventoryValue: 0 } },
    { page, limit, total }
  );
});

// ─── Stock Adjustment ─────────────────────────────────────────────────────────

/** PATCH /admin/inventory/products/:id/variants/:sku/stock */
export const adjustVariantStock = catchAsync(async (req: AuthRequest, res: Response, next: NextFunction) => {
  const { id, sku } = req.params;
  const { delta, reason, note, costPrice, price } = req.body as {
    delta: number;
    reason: string;
    note?: string;
    costPrice?: number;
    price?: number;
  };

  if (!Types.ObjectId.isValid(id)) return next(new AppError('Invalid product id.', 400));
  
  const hasFinancialUpdate = typeof costPrice === 'number' || typeof price === 'number';
  if (!Number.isFinite(delta) && !hasFinancialUpdate) {
    return next(new AppError('Must provide either a delta or a financial update (costPrice/price).', 400));
  }

  const VALID_REASONS = ['purchase', 'sale_return', 'damage', 'manual_correction', 'opening_stock'];
  if (!VALID_REASONS.includes(reason)) {
    return next(new AppError(`reason must be one of: ${VALID_REASONS.join(', ')}`, 400));
  }

  const product = await Product.findById(id);
  if (!product) return next(new AppError('Product not found.', 404));

  const variantIdx = product.variants.findIndex((v) => v.sku === sku);
  if (variantIdx === -1) return next(new AppError('Variant SKU not found.', 404));

  const variant = product.variants[variantIdx]!;
  
  // Stock update
  if (Number.isFinite(delta) && delta !== 0) {
    const newStock = variant.stock + delta;
    if (newStock < 0) {
      return next(new AppError(`Cannot reduce stock below 0. Current stock: ${variant.stock}.`, 400));
    }
    variant.stock = newStock;
  }

  // Financial update
  if (typeof costPrice === 'number') variant.costPrice = costPrice;
  if (typeof price === 'number') variant.price = price;

  product.totalStock = product.variants.reduce((acc, v) => acc + v.stock, 0);
  await product.save();

  // Log the movement if stock changed
  if (delta !== 0) {
    await logStockMovement(id, sku, delta, {
      reason: reason as any,
      referenceType: 'manual',
      actor: req.user?._id,
      note,
    });
  }

  await writeAdminAudit(req, 'inventory.stock.adjusted', {
    productId: id,
    sku,
    delta: delta || 0,
    reason,
    newStock: variant.stock,
    costPrice,
    price
  });

  sendSuccess(res, { product }, 'Stock adjusted successfully.');
});

// ─── Stock Ledger ─────────────────────────────────────────────────────────────

/** GET /admin/inventory/ledger */
export const getStockLedger = catchAsync(async (req: Request, res: Response) => {
  const page = Math.max(1, parseInt((req.query.page as string) || '1', 10));
  const limit = Math.min(100, Math.max(1, parseInt((req.query.limit as string) || '30', 10)));
  const skip = (page - 1) * limit;

  const filter: Record<string, unknown> = {};
  const productId = String(req.query.product || '').trim();
  const sku = String(req.query.sku || '').trim();
  const reason = String(req.query.reason || '').trim();
  const from = String(req.query.from || '').trim();
  const to = String(req.query.to || '').trim();

  if (productId && Types.ObjectId.isValid(productId)) filter.product = productId;
  if (sku) filter.sku = sku;
  if (reason) filter.reason = reason;
  if (from || to) {
    const createdAt: Record<string, Date> = {};
    if (from) createdAt.$gte = new Date(from);
    if (to) createdAt.$lte = new Date(to);
    filter.createdAt = createdAt;
  }

  const [entries, total] = await Promise.all([
    StockLedger.find(filter)
      .sort('-createdAt')
      .skip(skip)
      .limit(limit)
      .populate('actor', 'name email')
      .lean(),
    StockLedger.countDocuments(filter),
  ]);

  sendPaginated(res, { entries }, { page, limit, total });
});

// ─── Inventory Valuation ──────────────────────────────────────────────────────

/** GET /admin/inventory/valuation */
export const getInventoryValuation = catchAsync(async (_req: Request, res: Response) => {
  const [overall, byCategory] = await Promise.all([
    Product.aggregate([
      { $match: { isActive: true } },
      { $unwind: '$variants' },
      {
        $group: {
          _id: null,
          totalUnits: { $sum: '$variants.stock' },
          totalCostValue: {
            $sum: { $multiply: [{ $ifNull: ['$variants.costPrice', 0] }, '$variants.stock'] },
          },
          totalSaleValue: {
            $sum: {
              $multiply: [
                { $ifNull: ['$variants.price', '$price'] },
                '$variants.stock',
              ],
            },
          },
        },
      },
      {
        $addFields: {
          potentialMargin: {
            $cond: [
              { $gt: ['$totalSaleValue', 0] },
              {
                $round: [
                  {
                    $multiply: [
                      {
                        $divide: [
                          { $subtract: ['$totalSaleValue', '$totalCostValue'] },
                          '$totalSaleValue',
                        ],
                      },
                      100,
                    ],
                  },
                  2,
                ],
              },
              0,
            ],
          },
        },
      },
    ]),
    Product.aggregate([
      { $match: { isActive: true } },
      { $unwind: '$variants' },
      {
        $group: {
          _id: '$category',
          units: { $sum: '$variants.stock' },
          costValue: {
            $sum: { $multiply: [{ $ifNull: ['$variants.costPrice', 0] }, '$variants.stock'] },
          },
          saleValue: {
            $sum: {
              $multiply: [
                { $ifNull: ['$variants.price', '$price'] },
                '$variants.stock',
              ],
            },
          },
          products: { $addToSet: '$_id' },
        },
      },
      {
        $project: {
          category: '$_id',
          units: 1,
          costValue: 1,
          saleValue: 1,
          productCount: { $size: '$products' },
        },
      },
      { $sort: { costValue: -1 } },
    ]),
  ]);

  const o = overall[0] || { totalUnits: 0, totalCostValue: 0, totalSaleValue: 0, potentialMargin: 0 };

  sendSuccess(res, {
    overall: o,
    byCategory,
  });
});

// ─── Purchase Invoices ────────────────────────────────────────────────────────

/** GET /admin/inventory/purchase-invoices */
export const listPurchaseInvoices = catchAsync(async (req: Request, res: Response) => {
  const page = Math.max(1, parseInt((req.query.page as string) || '1', 10));
  const limit = Math.min(100, Math.max(1, parseInt((req.query.limit as string) || '20', 10)));
  const skip = (page - 1) * limit;
  const search = String(req.query.search || '').trim();
  const paymentStatus = String(req.query.paymentStatus || '').trim();
  const from = String(req.query.from || '').trim();
  const to = String(req.query.to || '').trim();

  const filter: Record<string, unknown> = {};
  if (search) {
    filter.$or = [
      { supplierName: { $regex: search, $options: 'i' } },
      { invoiceNumber: { $regex: search, $options: 'i' } },
      { supplierGstin: { $regex: search, $options: 'i' } },
    ];
  }
  if (paymentStatus) filter.paymentStatus = paymentStatus;
  if (from || to) {
    const dateFilter: Record<string, Date> = {};
    if (from) dateFilter.$gte = new Date(from);
    if (to) dateFilter.$lte = new Date(to);
    filter.invoiceDate = dateFilter;
  }

  const [invoices, total] = await Promise.all([
    PurchaseInvoice.find(filter)
      .sort('-invoiceDate')
      .skip(skip)
      .limit(limit)
      .populate('createdBy', 'name email')
      .lean(),
    PurchaseInvoice.countDocuments(filter),
  ]);

  sendPaginated(res, { invoices }, { page, limit, total });
});

/** GET /admin/inventory/purchase-invoices/:id */
export const getPurchaseInvoice = catchAsync(async (req: Request, res: Response, next: NextFunction) => {
  const inv = await PurchaseInvoice.findById(req.params.id)
    .populate('createdBy', 'name email')
    .lean();
  if (!inv) return next(new AppError('Purchase invoice not found.', 404));
  sendSuccess(res, { invoice: inv });
});

/** POST /admin/inventory/purchase-invoices */
export const createPurchaseInvoice = catchAsync(async (req: AuthRequest, res: Response, next: NextFunction) => {
  const body = req.body as {
    invoiceNumber: string;
    supplierName: string;
    supplierGstin?: string;
    supplyType?: 'intra' | 'inter';
    invoiceDate: string;
    lineItems: {
      product?: string;
      productName: string;
      sku: string;
      variantLabel?: string;
      quantity: number;
      unitCost: number;
      hsn?: string;
      gstRate?: number;
    }[];
    paymentStatus?: 'unpaid' | 'paid' | 'partial';
    paidAmount?: number;
    notes?: string;
    updateCostPrice?: boolean;
  };

  if (!body.lineItems?.length) return next(new AppError('At least one line item is required.', 400));

  const supplyType = body.supplyType ?? 'intra';
  const processedLines = body.lineItems.map((li) => {
    const gstRate = Number(li.gstRate ?? 0);
    const calc = calcLineItem(li.quantity, li.unitCost, gstRate, supplyType);
    return {
      product: li.product && Types.ObjectId.isValid(li.product) ? li.product : undefined,
      productName: li.productName,
      sku: li.sku,
      variantLabel: li.variantLabel,
      quantity: li.quantity,
      unitCost: li.unitCost,
      hsn: li.hsn,
      gstRate,
      ...calc,
    };
  });

  const totalTaxable = processedLines.reduce((s, l) => s + l.taxableAmount, 0);
  const totalCgst = processedLines.reduce((s, l) => s + l.cgst, 0);
  const totalSgst = processedLines.reduce((s, l) => s + l.sgst, 0);
  const totalIgst = processedLines.reduce((s, l) => s + l.igst, 0);
  const totalTax = totalCgst + totalSgst + totalIgst;
  const grandTotal = totalTaxable + totalTax;

  const invoice = await PurchaseInvoice.create({
    invoiceNumber: body.invoiceNumber,
    supplierName: body.supplierName,
    supplierGstin: body.supplierGstin,
    supplyType,
    invoiceDate: new Date(body.invoiceDate),
    lineItems: processedLines,
    totalTaxable: Math.round(totalTaxable * 100) / 100,
    totalCgst: Math.round(totalCgst * 100) / 100,
    totalSgst: Math.round(totalSgst * 100) / 100,
    totalIgst: Math.round(totalIgst * 100) / 100,
    totalTax: Math.round(totalTax * 100) / 100,
    grandTotal: Math.round(grandTotal * 100) / 100,
    paymentStatus: body.paymentStatus ?? 'unpaid',
    paidAmount: body.paidAmount ?? 0,
    notes: body.notes,
    createdBy: req.user?._id,
  });

  // Increment stock + log ledger for each catalog line item
  for (const li of processedLines) {
    if (li.product && li.sku && li.quantity > 0) {
      await incrementVariantStock(li.product as string, li.sku, li.quantity, { 
        variantLabel: li.variantLabel,
        costPrice: li.unitCost 
      });
      await logStockMovement(li.product as string, li.sku, li.quantity, {
        reason: 'purchase',
        referenceId: String(invoice._id),
        referenceType: 'purchase_invoice',
        actor: req.user?._id,
        note: `Purchase invoice ${body.invoiceNumber}`,
      });

      // Optionally update costPrice on variant
      if (body.updateCostPrice !== false) {
        await Product.updateOne(
          { _id: li.product, 'variants.sku': li.sku },
          { $set: { 'variants.$[v].costPrice': li.unitCost } },
          { arrayFilters: [{ 'v.sku': li.sku }] }
        );
      }
    }
  }

  await writeAdminAudit(req, 'inventory.purchase_invoice.created', {
    invoiceId: String(invoice._id),
    invoiceNumber: invoice.invoiceNumber,
    grandTotal: invoice.grandTotal,
  });

  sendSuccess(res, { invoice }, 'Purchase invoice created.', 201);
});

/** PUT /admin/inventory/purchase-invoices/:id */
export const updatePurchaseInvoice = catchAsync(async (req: AuthRequest, res: Response, next: NextFunction) => {
  const inv = await PurchaseInvoice.findById(req.params.id);
  if (!inv) return next(new AppError('Purchase invoice not found.', 404));

  const body = req.body as Partial<{
    invoiceNumber: string;
    supplierName: string;
    supplierGstin: string;
    supplyType: 'intra' | 'inter';
    invoiceDate: string;
    paymentStatus: 'unpaid' | 'paid' | 'partial';
    paidAmount: number;
    notes: string;
  }>;

  if (body.invoiceNumber) inv.invoiceNumber = body.invoiceNumber;
  if (body.supplierName) inv.supplierName = body.supplierName;
  if (body.supplierGstin !== undefined) inv.supplierGstin = body.supplierGstin;
  if (body.supplyType) inv.supplyType = body.supplyType;
  if (body.invoiceDate) inv.invoiceDate = new Date(body.invoiceDate);
  if (body.paymentStatus) inv.paymentStatus = body.paymentStatus;
  if (body.paidAmount !== undefined) inv.paidAmount = body.paidAmount;
  if (body.notes !== undefined) inv.notes = body.notes;

  await inv.save();
  await writeAdminAudit(req, 'inventory.purchase_invoice.updated', { invoiceId: String(inv._id) });

  sendSuccess(res, { invoice: inv });
});

/** DELETE /admin/inventory/purchase-invoices/:id */
export const deletePurchaseInvoice = catchAsync(async (req: AuthRequest, res: Response, next: NextFunction) => {
  const inv = await PurchaseInvoice.findById(req.params.id);
  if (!inv) return next(new AppError('Purchase invoice not found.', 404));

  await PurchaseInvoice.findByIdAndDelete(req.params.id);
  await writeAdminAudit(req, 'inventory.purchase_invoice.deleted', {
    invoiceId: req.params.id,
    invoiceNumber: inv.invoiceNumber,
  });

  res.status(204).end();
});

// ─── GST Summary ─────────────────────────────────────────────────────────────

/** GET /admin/inventory/gst-summary
 *  Query: year (YYYY), month (1-12 or 'all'), quarter (1-4 or 'all')
 */
export const getGstPurchaseSummary = catchAsync(async (req: Request, res: Response) => {
  const year = parseInt((req.query.year as string) || String(new Date().getFullYear()), 10);
  const monthParam = req.query.month as string;
  const quarterParam = req.query.quarter as string;

  const startDate = new Date(`${year}-01-01T00:00:00.000Z`);
  const endDate = new Date(`${year + 1}-01-01T00:00:00.000Z`);

  const dateFilter: Record<string, Date> = { $gte: startDate, $lt: endDate };

  if (monthParam && monthParam !== 'all') {
    const m = parseInt(monthParam, 10);
    const mStart = new Date(year, m - 1, 1);
    const mEnd = new Date(year, m, 1);
    dateFilter.$gte = mStart;
    dateFilter.$lt = mEnd;
  } else if (quarterParam && quarterParam !== 'all') {
    const q = parseInt(quarterParam, 10);
    const qStart = new Date(year, (q - 1) * 3, 1);
    const qEnd = new Date(year, q * 3, 1);
    dateFilter.$gte = qStart;
    dateFilter.$lt = qEnd;
  }

  const [bySupplier, monthly] = await Promise.all([
    PurchaseInvoice.aggregate([
      { $match: { invoiceDate: dateFilter } },
      {
        $group: {
          _id: { gstin: { $ifNull: ['$supplierGstin', 'UNREGISTERED'] }, name: '$supplierName' },
          invoiceCount: { $sum: 1 },
          totalTaxable: { $sum: '$totalTaxable' },
          totalCgst: { $sum: '$totalCgst' },
          totalSgst: { $sum: '$totalSgst' },
          totalIgst: { $sum: '$totalIgst' },
          totalTax: { $sum: '$totalTax' },
          grandTotal: { $sum: '$grandTotal' },
        },
      },
      {
        $project: {
          _id: 0,
          gstin: '$_id.gstin',
          supplierName: '$_id.name',
          invoiceCount: 1,
          totalTaxable: 1,
          totalCgst: 1,
          totalSgst: 1,
          totalIgst: 1,
          totalTax: 1,
          grandTotal: 1,
        },
      },
      { $sort: { grandTotal: -1 } },
    ]),
    PurchaseInvoice.aggregate([
      { $match: { invoiceDate: { $gte: startDate, $lt: endDate } } },
      {
        $group: {
          _id: {
            year: { $year: '$invoiceDate' },
            month: { $month: '$invoiceDate' },
          },
          invoiceCount: { $sum: 1 },
          totalTaxable: { $sum: '$totalTaxable' },
          totalCgst: { $sum: '$totalCgst' },
          totalSgst: { $sum: '$totalSgst' },
          totalIgst: { $sum: '$totalIgst' },
          totalTax: { $sum: '$totalTax' },
          grandTotal: { $sum: '$grandTotal' },
        },
      },
      { $sort: { '_id.year': 1, '_id.month': 1 } },
    ]),
  ]);

  const totals = bySupplier.reduce(
    (acc, s) => ({
      taxable: acc.taxable + s.totalTaxable,
      cgst: acc.cgst + s.totalCgst,
      sgst: acc.sgst + s.totalSgst,
      igst: acc.igst + s.totalIgst,
      tax: acc.tax + s.totalTax,
      grand: acc.grand + s.grandTotal,
    }),
    { taxable: 0, cgst: 0, sgst: 0, igst: 0, tax: 0, grand: 0 }
  );

  sendSuccess(res, { bySupplier, monthly, totals, year });
});
