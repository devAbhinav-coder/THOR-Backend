import { z } from 'zod';

const mongoId = z
  .string()
  .regex(/^[a-fA-F0-9]{24}$/, 'Invalid order id');

const ORDER_STATUSES = [
  'pending',
  'confirmed',
  'processing',
  'shipped',
  'delivered',
  'cancelled',
  'refunded',
] as const;

const trimCollapse = (v: string) => v.normalize('NFC').trim().replace(/\s+/g, ' ');

const pageQuery = z.preprocess(
  (val) => {
    if (val === undefined || val === null || val === '') return 1;
    const n = Number(val);
    return Number.isFinite(n) ? Math.max(1, Math.floor(n)) : 1;
  },
  z.number().int().min(1).max(10_000)
);

const limitQuery = z.preprocess(
  (val) => {
    if (val === undefined || val === null || val === '') return 10;
    const n = Number(val);
    return Number.isFinite(n) ? Math.floor(n) : 10;
  },
  z.number().int().min(1).max(100)
);

/** Comma-separated status filter — only known statuses allowed */
const orderStatusFilter = z
  .string()
  .max(120)
  .transform((v) => trimCollapse(v))
  .optional()
  .refine(
    (v) => {
      if (!v) return true;
      const parts = v.split(',').map((s) => s.trim()).filter(Boolean);
      return parts.length > 0 && parts.every((p) => ORDER_STATUSES.includes(p as (typeof ORDER_STATUSES)[number]));
    },
    { message: `status must be one of: ${ORDER_STATUSES.join(', ')} (comma-separated allowed)` }
  );

export const getMyOrdersSchema = z.object({
  query: z.object({
    page: pageQuery.optional(),
    limit: limitQuery.optional(),
    status: orderStatusFilter,
  }),
});

export const orderIdParamsSchema = z.object({
  params: z.object({
    id: mongoId,
  }),
});

export const cancelOrderSchema = z.object({
  params: z.object({
    id: mongoId,
  }),
  body: z
    .object({
      reason: z
        .string()
        .max(500)
        .transform((v) => trimCollapse(v))
        .optional(),
    })
    .default({}),
});

export const CUSTOMER_ORDER_STATUSES = ORDER_STATUSES;
