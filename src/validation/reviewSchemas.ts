import { z } from 'zod';
import { ALLOWED_REPORT_REASONS } from '../services/reviews/reviewConstants';

const mongoObjectId = z
  .string()
  .trim()
  .regex(/^[a-fA-F0-9]{24}$/, 'Invalid id');

const reviewText = z
  .string()
  .trim()
  .min(10, 'Comment must be at least 10 characters')
  .max(1000, 'Comment cannot exceed 1000 characters')
  .transform((v) => v.replace(/\s+/g, ' ').trim());

const reviewTitle = z
  .string()
  .trim()
  .max(100, 'Title cannot exceed 100 characters')
  .transform((v) => v.replace(/\s+/g, ' ').trim())
  .optional();

const paginationQuery = z.object({
  page: z.coerce.number().int().min(1).max(500).optional().default(1),
  limit: z.coerce.number().int().min(1).max(50).optional().default(10),
  sort: z.enum(['newest', 'highest', 'helpful', 'images']).optional(),
});

export const createReviewSchema = z.object({
  body: z.object({
    rating: z.coerce.number().int().min(1).max(5),
    title: reviewTitle,
    comment: reviewText,
    orderId: mongoObjectId,
    idempotencyKey: z.string().trim().min(8).max(128).optional(),
  }),
  params: z.object({
    productId: mongoObjectId,
  }),
});

export const updateReviewSchema = z.object({
  params: z.object({
    id: mongoObjectId,
  }),
  body: z
    .object({
      rating: z.coerce.number().int().min(1).max(5).optional(),
      title: reviewTitle,
      comment: reviewText.optional(),
    })
    .refine((b) => b.rating !== undefined || b.title !== undefined || b.comment !== undefined, {
      message: 'At least one field is required to update',
    }),
});

export const reviewIdParamSchema = z.object({
  params: z.object({
    id: mongoObjectId,
  }),
});

export const productIdParamSchema = z.object({
  params: z.object({
    productId: mongoObjectId,
  }),
});

export const getProductReviewsQuerySchema = z.object({
  params: z.object({
    productId: mongoObjectId,
  }),
  query: paginationQuery,
});

export const reportReviewSchema = z.object({
  params: z.object({
    id: mongoObjectId,
  }),
  body: z.object({
    reason: z.enum(ALLOWED_REPORT_REASONS),
    details: z
      .string()
      .trim()
      .max(300, 'Report details cannot exceed 300 characters')
      .optional()
      .transform((v) => (v && v.length > 0 ? v : undefined)),
  }),
});

export type ProductReviewsQuery = z.infer<typeof paginationQuery>;

export const adminReviewIdParamSchema = z.object({
  params: z.object({
    id: mongoObjectId,
  }),
});

export const adminReplyReviewSchema = z.object({
  params: z.object({
    id: mongoObjectId,
  }),
  body: z.object({
    text: z
      .string()
      .trim()
      .min(1, 'Reply text is required')
      .max(500, 'Reply cannot exceed 500 characters')
      .transform((v) => v.replace(/\s+/g, ' ').trim()),
  }),
});

export const adminModerateReviewSchema = z.object({
  params: z.object({
    id: mongoObjectId,
  }),
  body: z.object({
    action: z.enum(['approve', 'hide', 'restore']),
  }),
});

export const adminGetReviewsQuerySchema = z.object({
  query: z.object({
    page: z.coerce.number().int().min(1).max(500).optional().default(1),
    limit: z.coerce.number().int().min(1).max(100).optional().default(20),
    status: z
      .enum(['visible', 'hidden', 'flagged', 'pending_moderation', 'all'])
      .optional()
      .default('all')
      .transform((s) => (s === 'all' ? 'all' : s)),
  }),
});

export function parseProductReviewsQuery(
  query: z.infer<typeof paginationQuery>
): { page: number; limit: number; sort?: string } {
  return {
    page: query.page,
    limit: query.limit,
    sort: query.sort,
  };
}
