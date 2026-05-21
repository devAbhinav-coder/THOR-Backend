import { z } from 'zod';
import { OPERATING_EXPENSE_CATEGORIES } from '../models/OperatingExpense';

const objectId = z.string().regex(/^[a-fA-F0-9]{24}$/);

const categoryEnum = z.enum(OPERATING_EXPENSE_CATEGORIES);

export const operatingExpenseListQuerySchema = z.object({
  query: z
    .object({
      page: z.coerce.number().int().min(1).default(1),
      limit: z.coerce.number().int().min(1).max(100).default(30),
      category: categoryEnum.optional(),
      from: z.string().optional(),
      to: z.string().optional(),
      search: z.string().max(200).optional(),
    })
    .transform((q) => ({
      page: q.page,
      limit: q.limit,
      category: q.category,
      from: q.from?.trim(),
      to: q.to?.trim(),
      search: q.search?.trim(),
    })),
});

export const operatingExpenseSummaryQuerySchema = z.object({
  query: z.object({
    year: z.coerce.number().int().min(2000).max(2100).optional(),
  }),
});

export const createOperatingExpenseSchema = z.object({
  body: z.object({
    category: categoryEnum,
    title: z.string().min(1).max(200).transform((s) => s.trim()),
    amount: z.coerce.number().min(0),
    expenseDate: z.string().min(1),
    notes: z.string().max(2000).optional(),
  }),
});

export const updateOperatingExpenseSchema = z.object({
  body: z.object({
    category: categoryEnum.optional(),
    title: z.string().min(1).max(200).optional(),
    amount: z.coerce.number().min(0).optional(),
    expenseDate: z.string().optional(),
    notes: z.string().max(2000).optional(),
  }),
  params: z.object({ id: objectId }),
});

export const operatingExpenseIdParamsSchema = z.object({
  params: z.object({ id: objectId }),
});
