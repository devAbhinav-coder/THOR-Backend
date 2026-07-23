import { z } from 'zod';

const optionalBooleanFromString = z.preprocess(
  (val) => {
    if (val === undefined || val === null || val === '') return undefined;
    if (val === 'true') return true;
    if (val === 'false') return false;
    return val;
  },
  z.boolean().optional()
);

const mongoObjectId = z
  .string()
  .regex(/^[a-fA-F0-9]{24}$/, 'Invalid id');

const jsonStringToArray = <T extends z.ZodTypeAny>(itemSchema: T) =>
  z.preprocess((val) => {
    if (val === undefined || val === null || val === '') return undefined;
    if (Array.isArray(val)) return val;
    if (typeof val === 'string') {
      try {
        const parsed = JSON.parse(val);
        return Array.isArray(parsed) ? parsed : undefined;
      } catch {
        return undefined;
      }
    }
    return val;
  }, z.array(itemSchema).optional());

const scopeRefine = (
  data: {
    scopeType?: string;
    categoryIds?: string[];
    subcategoryIds?: string[];
    productIds?: string[];
    discountType?: string;
    discountValue?: number;
    startDate?: string;
    endDate?: string;
  },
  ctx: z.RefinementCtx
) => {
  if (data.startDate && data.endDate) {
    const start = new Date(data.startDate);
    const end = new Date(data.endDate);
    if (!Number.isNaN(start.getTime()) && !Number.isNaN(end.getTime()) && end <= start) {
      ctx.addIssue({
        code: 'custom',
        message: 'End date must be after start date',
        path: ['endDate'],
      });
    }
  }
  if (data.discountType === 'percentage' && data.discountValue != null && data.discountValue > 100) {
    ctx.addIssue({
      code: 'custom',
      message: 'Percentage discount cannot exceed 100',
      path: ['discountValue'],
    });
  }
  const scope = data.scopeType || 'all';
  if (scope === 'categories' && !(data.categoryIds?.length)) {
    ctx.addIssue({
      code: 'custom',
      message: 'Select at least one category',
      path: ['categoryIds'],
    });
  }
  if (scope === 'subcategories' && !(data.subcategoryIds?.length)) {
    ctx.addIssue({
      code: 'custom',
      message: 'Select at least one subcategory',
      path: ['subcategoryIds'],
    });
  }
  if (scope === 'products' && !(data.productIds?.length)) {
    ctx.addIssue({
      code: 'custom',
      message: 'Select at least one product',
      path: ['productIds'],
    });
  }
};

export const createSaleCampaignSchema = z.object({
  body: z
    .object({
      name: z.string().trim().min(1).max(120),
      description: z.string().max(500).optional(),
      badgeText: z.string().max(40).optional(),
      discountType: z.enum(['percentage', 'flat', 'fixed']),
      discountValue: z.coerce.number().positive(),
      maxDiscountPerItem: z.coerce.number().positive().optional(),
      imageUrl: z.string().max(2000).optional(),
      imagePublicId: z.string().max(500).optional(),
      showOnStorefront: optionalBooleanFromString,
      scopeType: z.enum(['all', 'categories', 'subcategories', 'products']).default('all'),
      categoryIds: jsonStringToArray(mongoObjectId),
      subcategoryIds: jsonStringToArray(mongoObjectId),
      productIds: jsonStringToArray(mongoObjectId),
      startDate: z.string().min(1),
      endDate: z.string().min(1),
      isActive: optionalBooleanFromString,
      clearImage: optionalBooleanFromString,
    })
    .superRefine(scopeRefine),
});

export const updateSaleCampaignSchema = z.object({
  params: z.object({ id: mongoObjectId }),
  body: z
    .object({
      name: z.string().trim().min(1).max(120).optional(),
      description: z.string().max(500).optional(),
      badgeText: z.string().max(40).optional(),
      discountType: z.enum(['percentage', 'flat', 'fixed']).optional(),
      discountValue: z.coerce.number().positive().optional(),
      maxDiscountPerItem: z.coerce.number().positive().optional(),
      imageUrl: z.string().max(2000).optional(),
      imagePublicId: z.string().max(500).optional(),
      showOnStorefront: optionalBooleanFromString,
      scopeType: z.enum(['all', 'categories', 'subcategories', 'products']).optional(),
      categoryIds: jsonStringToArray(mongoObjectId),
      subcategoryIds: jsonStringToArray(mongoObjectId),
      productIds: jsonStringToArray(mongoObjectId),
      startDate: z.string().min(1).optional(),
      endDate: z.string().min(1).optional(),
      isActive: optionalBooleanFromString,
      clearImage: optionalBooleanFromString,
    })
    .refine((b) => Object.keys(b).length > 0, { message: 'At least one field is required' })
    .superRefine(scopeRefine),
});

export const saleCampaignIdParamsSchema = z.object({
  params: z.object({ id: mongoObjectId }),
});

export const previewSaleCampaignSchema = z.object({
  body: z.object({
    scopeType: z.enum(['all', 'categories', 'subcategories', 'products']).default('all'),
    categoryIds: z.array(mongoObjectId).optional(),
    subcategoryIds: z.array(mongoObjectId).optional(),
    productIds: z.array(mongoObjectId).optional(),
  }),
});
