import { z } from 'zod';

/** Matches multipart form `items` JSON string parsing in schemas.ts */
const jsonStringToArray = <T extends z.ZodTypeAny>(itemSchema: T) =>
  z.preprocess((val) => {
    if (Array.isArray(val)) return val;
    if (typeof val === 'string') {
      try {
        const parsed = JSON.parse(val);
        return Array.isArray(parsed) ? parsed : [parsed];
      } catch {
        return [];
      }
    }
    return val;
  }, z.array(itemSchema));

const giftingItemSchema = z.object({
  product: z.string().regex(/^[a-fA-F0-9]{24}$/, 'Invalid product id'),
  name: z.string().min(1).max(200).transform((s) => s.trim()),
  quantity: z.coerce.number().int().min(1).max(10000),
  customFieldAnswers: z
    .array(
      z.object({
        fieldId: z.string().min(1).max(64),
        label: z.string().min(1).max(120),
        value: z.string().min(1).max(500),
      })
    )
    .optional(),
});

export const submitGiftingRequestSchema = z.object({
  body: z.object({
    name: z.string().min(2).max(80).transform((s) => s.trim()),
    email: z.string().email().transform((s) => s.trim().toLowerCase()),
    phone: z.string().trim().max(20).optional(),
    occasion: z.string().min(2).max(120).transform((s) => s.trim()),
    items: jsonStringToArray(giftingItemSchema).refine(
      (arr) => arr.length > 0,
      'At least one item is required'
    ),
    recipientMessage: z.string().max(500).optional(),
    customizationNote: z.string().max(1000).optional(),
    packagingPreference: z.enum(['standard', 'premium', 'custom']).optional(),
    customPackagingNote: z.string().max(500).optional(),
    proposedPrice: z.coerce.number().positive().optional(),
  }),
});

export const giftingAdminUpdateSchema = z.object({
  body: z.object({
    status: z
      .enum(['new', 'price_quoted', 'approved_by_user', 'rejected_by_user', 'cancelled'])
      .optional(),
    adminNote: z.string().max(1000).optional(),
    quotedPrice: z.coerce.number().positive().optional(),
    deliveryTime: z.string().max(120).optional(),
  }),
  params: z.object({
    id: z.string().regex(/^[a-fA-F0-9]{24}$/),
  }),
});

export const giftingRespondSchema = z.object({
  body: z
    .object({
      action: z.enum(['accept', 'reject']),
      shippingAddress: z
        .object({
          name: z.string().min(2).max(80),
          phone: z.string().trim().max(20).optional(),
          label: z.string().max(40).optional(),
          house: z.string().max(120).optional(),
          street: z.string().min(5).max(250),
          landmark: z.string().max(160).optional(),
          city: z.string().min(2).max(80),
          state: z.string().min(2).max(80),
          pincode: z.string().regex(/^\d{6}$/),
          country: z.string().max(60).optional(),
        })
        .optional(),
    })
    .superRefine((data, ctx) => {
      if (data.action === 'accept' && !data.shippingAddress) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'shippingAddress is required when accepting a quote',
          path: ['shippingAddress'],
        });
      }
    }),
  params: z.object({
    id: z.string().regex(/^[a-fA-F0-9]{24}$/),
  }),
});
