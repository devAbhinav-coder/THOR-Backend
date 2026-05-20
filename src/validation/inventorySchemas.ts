import { z } from 'zod';

const objectId = z.string().regex(/^[a-fA-F0-9]{24}$/);

const paginationQuery = {
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
};

export const inventoryOverviewQuerySchema = z.object({
  query: z
    .object({
      ...paginationQuery,
      limit: z.coerce.number().int().min(1).max(100).default(20),
      search: z.string().max(200).optional(),
      category: z.string().max(100).optional(),
      filter: z.enum(['all', 'low', 'out']).default('all'),
      sort: z
        .enum(['name', '-name', 'stock', '-stock', 'category', '-updatedAt', 'updatedAt'])
        .default('-updatedAt'),
    })
    .transform((q) => ({
      page: q.page,
      limit: q.limit,
      search: q.search?.trim(),
      category: q.category?.trim(),
      filter: q.filter,
      sort: q.sort,
    })),
});

export const stockLedgerQuerySchema = z.object({
  query: z
    .object({
      page: z.coerce.number().int().min(1).default(1),
      limit: z.coerce.number().int().min(1).max(100).default(30),
      product: objectId.optional(),
      sku: z.string().max(80).optional(),
      reason: z
        .enum(['sale', 'sale_return', 'purchase', 'damage', 'manual_correction', 'opening_stock'])
        .optional(),
      from: z.string().optional(),
      to: z.string().optional(),
    })
    .transform((q) => ({
      page: q.page,
      limit: q.limit,
      productId: q.product?.trim(),
      sku: q.sku?.trim(),
      reason: q.reason,
      from: q.from?.trim(),
      to: q.to?.trim(),
    })),
});

export const purchaseInvoiceListQuerySchema = z.object({
  query: z
    .object({
      ...paginationQuery,
      search: z.string().max(200).optional(),
      paymentStatus: z.enum(['unpaid', 'paid', 'partial']).optional(),
      from: z.string().optional(),
      to: z.string().optional(),
    })
    .transform((q) => ({
      page: q.page,
      limit: q.limit,
      search: q.search?.trim(),
      paymentStatus: q.paymentStatus,
      from: q.from?.trim(),
      to: q.to?.trim(),
    })),
});

export const gstSummaryQuerySchema = z.object({
  query: z.object({
    year: z.coerce.number().int().min(2000).max(2100).optional(),
    month: z.union([z.coerce.number().int().min(1).max(12), z.literal('all')]).optional(),
    quarter: z.union([z.coerce.number().int().min(1).max(4), z.literal('all')]).optional(),
  }),
});

export const stockAdjustmentSchema = z.object({
  body: z
    .object({
      delta: z.coerce.number().optional(),
      reason: z.enum(['purchase', 'sale_return', 'damage', 'manual_correction', 'opening_stock']),
      note: z.string().max(1000).optional(),
      costPrice: z.coerce.number().min(0).optional(),
      price: z.coerce.number().min(0).optional(),
    })
    .superRefine((data, ctx) => {
      const hasFinancial =
        typeof data.costPrice === 'number' || typeof data.price === 'number';
      const delta = data.delta;
      if (!hasFinancial && (!Number.isFinite(delta) || delta === 0)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Must provide a non-zero delta or costPrice/price update',
          path: ['delta'],
        });
      }
    }),
  params: z.object({
    id: objectId,
    sku: z.string().min(1).max(80),
  }),
});

const purchaseLineItemSchema = z.object({
  product: objectId.optional(),
  productName: z.string().min(1).max(200).transform((s) => s.trim()),
  sku: z.string().min(1).max(80).transform((s) => s.trim()),
  variantLabel: z.string().max(100).optional(),
  quantity: z.coerce.number().int().min(1),
  unitCost: z.coerce.number().min(0),
  hsn: z.string().max(20).optional(),
  gstRate: z.coerce.number().min(0).max(100).default(0),
});

export const createPurchaseInvoiceSchema = z.object({
  body: z.object({
    invoiceNumber: z.string().min(1).max(80).transform((s) => s.trim()),
    supplierName: z.string().min(1).max(200).transform((s) => s.trim()),
    supplierGstin: z
      .string()
      .max(15)
      .regex(/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/, 'Invalid GSTIN')
      .optional()
      .or(z.literal('')),
    supplyType: z.enum(['intra', 'inter']).default('intra'),
    invoiceDate: z.string().min(1, 'Invoice date is required'),
    lineItems: z.array(purchaseLineItemSchema).min(1, 'At least one line item required').max(50),
    paymentStatus: z.enum(['unpaid', 'paid', 'partial']).default('unpaid'),
    paidAmount: z.coerce.number().min(0).default(0),
    notes: z.string().max(2000).optional(),
    updateCostPrice: z.boolean().optional().default(true),
  }),
});

export const updatePurchaseInvoiceSchema = z.object({
  body: z.object({
    invoiceNumber: z.string().min(1).max(80).optional(),
    supplierName: z.string().min(1).max(200).optional(),
    supplierGstin: z.string().max(15).optional().or(z.literal('')),
    supplyType: z.enum(['intra', 'inter']).optional(),
    invoiceDate: z.string().optional(),
    paymentStatus: z.enum(['unpaid', 'paid', 'partial']).optional(),
    paidAmount: z.coerce.number().min(0).optional(),
    notes: z.string().max(2000).optional(),
  }),
  params: z.object({
    id: objectId,
  }),
});

export const purchaseInvoiceIdParamsSchema = z.object({
  params: z.object({
    id: objectId,
  }),
});
