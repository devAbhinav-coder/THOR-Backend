import { z } from 'zod';

const optionalBooleanFromString = z.preprocess(
  (val) => {
    if (val === undefined || val === null || val === '') return undefined;
    if (val === 'true') return true;
    if (val === 'false') return false;
    return val;
  },
  z.boolean().optional(),
);

const mongoObjectId = z.string().regex(/^[a-fA-F0-9]{24}$/, 'Invalid id');

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
    promotionType?: string;
    discountValue?: number;
    buyQuantity?: number;
    getQuantity?: number;
    startDate?: string;
    endDate?: string;
  },
  ctx: z.RefinementCtx,
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
  if (
    data.promotionType === 'percentage' &&
    data.discountValue != null &&
    data.discountValue > 100
  ) {
    ctx.addIssue({
      code: 'custom',
      message: 'Percentage discount cannot exceed 100',
      path: ['discountValue'],
    });
  }
  if (data.promotionType === 'bogo') {
    if (!data.buyQuantity || data.buyQuantity < 1) {
      ctx.addIssue({
        code: 'custom',
        message: 'Buy quantity must be at least 1',
        path: ['buyQuantity'],
      });
    }
    if (!data.getQuantity || data.getQuantity < 1) {
      ctx.addIssue({
        code: 'custom',
        message: 'Get quantity must be at least 1',
        path: ['getQuantity'],
      });
    }
  } else if (!data.discountValue || data.discountValue <= 0) {
    ctx.addIssue({
      code: 'custom',
      message: 'Discount value is required',
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

export const createPromotionSchema = z.object({
  body: z
    .object({
      name: z.string().trim().min(1).max(120),
      description: z.string().max(500).optional(),
      termsAndConditions: z.string().max(2000).optional(),
      displayTitle: z.string().max(120).optional(),
      badgeText: z.string().max(40).optional(),
      imageUrl: z.string().max(2000).optional(),
      imagePublicId: z.string().max(500).optional(),
      promotionType: z.enum(['bogo', 'flat', 'percentage']),
      buyQuantity: z.coerce.number().int().min(1).default(1),
      getQuantity: z.coerce.number().int().min(1).default(1),
      getDiscountPercent: z.coerce.number().min(0).max(100).default(100),
      discountValue: z.coerce.number().min(0).optional(),
      maxDiscountAmount: z.coerce.number().positive().optional(),
      minOrderAmount: z.coerce.number().min(0).optional(),
      scopeType: z.enum(['all', 'categories', 'subcategories', 'products']).default('all'),
      categoryIds: jsonStringToArray(mongoObjectId),
      subcategoryIds: jsonStringToArray(mongoObjectId),
      productIds: jsonStringToArray(mongoObjectId),
      startDate: z.string().min(1),
      endDate: z.string().min(1),
      isActive: optionalBooleanFromString,
      showOnStorefront: optionalBooleanFromString,
      priority: z.coerce.number().int().default(0),
      clearImage: optionalBooleanFromString,
    })
    .superRefine(scopeRefine),
});

export const updatePromotionSchema = z.object({
  params: z.object({ id: mongoObjectId }),
  body: z
    .object({
      name: z.string().trim().min(1).max(120).optional(),
      description: z.string().max(500).optional(),
      termsAndConditions: z.string().max(2000).optional(),
      displayTitle: z.string().max(120).optional(),
      badgeText: z.string().max(40).optional(),
      imageUrl: z.string().max(2000).optional(),
      imagePublicId: z.string().max(500).optional(),
      promotionType: z.enum(['bogo', 'flat', 'percentage']).optional(),
      buyQuantity: z.coerce.number().int().min(1).optional(),
      getQuantity: z.coerce.number().int().min(1).optional(),
      getDiscountPercent: z.coerce.number().min(0).max(100).optional(),
      discountValue: z.coerce.number().min(0).optional(),
      maxDiscountAmount: z.coerce.number().positive().optional(),
      minOrderAmount: z.coerce.number().min(0).optional(),
      scopeType: z.enum(['all', 'categories', 'subcategories', 'products']).optional(),
      categoryIds: jsonStringToArray(mongoObjectId),
      subcategoryIds: jsonStringToArray(mongoObjectId),
      productIds: jsonStringToArray(mongoObjectId),
      startDate: z.string().min(1).optional(),
      endDate: z.string().min(1).optional(),
      isActive: optionalBooleanFromString,
      showOnStorefront: optionalBooleanFromString,
      priority: z.coerce.number().int().optional(),
      clearImage: optionalBooleanFromString,
    })
    .refine((b) => Object.keys(b).length > 0, { message: 'At least one field is required' })
    .superRefine(scopeRefine),
});

export const promotionIdParamsSchema = z.object({
  params: z.object({ id: mongoObjectId }),
});

export const previewPromotionSchema = z.object({
  body: z.object({
    scopeType: z.enum(['all', 'categories', 'subcategories', 'products']).default('all'),
    categoryIds: z.array(mongoObjectId).optional(),
    subcategoryIds: z.array(mongoObjectId).optional(),
    productIds: z.array(mongoObjectId).optional(),
  }),
});
