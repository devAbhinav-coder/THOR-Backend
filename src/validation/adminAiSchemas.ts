import { z } from 'zod';

const objectId = z.string().regex(/^[a-f\d]{24}$/i, 'Invalid id');

const aiChatTurnSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.string().min(1).max(800),
});

export const adminAiAskSchema = z.object({
  body: z.object({
    question: z.string().min(1).max(500),
    history: z.array(aiChatTurnSchema).max(12).optional(),
  }),
});

export const adminAiOrderIdSchema = z.object({
  params: z.object({ orderId: objectId }),
});

export const adminAiUserIdSchema = z.object({
  params: z.object({ userId: objectId }),
});

export const adminAiReviewIdSchema = z.object({
  params: z.object({ reviewId: objectId }),
});

const productVariantDraftSchema = z.object({
  size: z.string().max(40).optional(),
  color: z.string().max(80).optional(),
  sku: z.string().max(80).optional(),
  stock: z.coerce.number().int().min(0).optional(),
  price: z.coerce.number().min(0).optional(),
});

export const adminAiProductDraftSchema = z.object({
  body: z.object({
    name: z.string().min(2).max(200),
    category: z.string().max(100).optional(),
    subcategory: z.string().max(100).optional(),
    fabric: z.string().max(80).optional(),
    price: z.coerce.number().min(0).optional(),
    comparePrice: z.coerce.number().min(0).optional(),
    tags: z.array(z.string().max(40)).max(15).optional(),
    shortDescription: z.string().max(300).optional(),
    designNotes: z.string().max(1200).optional(),
    variants: z.array(productVariantDraftSchema).max(20).optional(),
    productId: objectId.optional(),
  }),
});

export const adminAiCatalogSeoDraftSchema = z.object({
  body: z.object({
    kind: z.enum(['category', 'subcategory']),
    name: z.string().min(2).max(120),
    parentCategoryName: z.string().max(120).optional(),
    description: z.string().max(500).optional(),
  }),
});

export const adminAiMarketingDraftSchema = z.object({
  body: z.object({
    adminBrief: z.string().min(10).max(3000),
    subjectHint: z.string().max(120).optional(),
    audience: z.enum(['all', 'users', 'admins', 'selected']).optional(),
    estimatedRecipients: z.coerce.number().int().min(0).optional(),
    ctaText: z.string().max(80).optional(),
    ctaLink: z.string().max(300).optional(),
    tone: z.string().max(120).optional(),
  }),
});

export const adminAiBriefQuerySchema = z.object({
  query: z.object({
    force: z.enum(['true', 'false']).optional(),
  }),
});

export const adminAiBlogDraftSchema = z.object({
  body: z.object({
    topic: z.string().min(8).max(300),
    keywords: z.array(z.string().max(60)).max(12).optional(),
    category: z.string().max(40).optional(),
    tone: z.string().max(120).optional(),
    targetLength: z.enum(['short', 'medium', 'long']).optional(),
    linkProductIds: z.array(objectId).max(6).optional(),
    includeProductLinks: z.boolean().optional(),
    regenerate: z.boolean().optional(),
  }),
});

export const adminAiBlogCalendarSchema = z.object({
  body: z.object({
    weeks: z.coerce.number().int().min(2).max(8).optional(),
    postsPerWeek: z.coerce.number().int().min(1).max(2).optional(),
    focus: z.string().max(200).optional(),
    regenerate: z.boolean().optional(),
  }),
});
