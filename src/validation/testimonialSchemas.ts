import { z } from "zod";

const mongoObjectId = z
  .string()
  .trim()
  .regex(/^[a-fA-F0-9]{24}$/, "Invalid id");

const boolish = z.union([z.boolean(), z.enum(["true", "false"])]);

export const submitPublicTestimonialSchema = z.object({
  body: z.object({
    displayName: z.string().trim().max(80).optional(),
    isAnonymous: boolish.optional(),
    quote: z.string().trim().min(10, "Please write a short story").max(1200),
    rating: z.coerce.number().int().min(1).max(5).optional(),
    productId: mongoObjectId.optional(),
  }),
});

export const createTestimonialSchema = z.object({
  body: z.object({
    displayName: z.string().trim().max(80).optional(),
    isAnonymous: boolish.optional(),
    quote: z.string().trim().min(10).max(1200),
    rating: z.coerce.number().int().min(1).max(5).optional(),
    sortOrder: z.coerce.number().int().min(0).max(9999).optional(),
  }),
});

export const updateTestimonialSchema = z.object({
  params: z.object({
    id: mongoObjectId,
  }),
  body: z.object({
    displayName: z.string().trim().max(80).optional(),
    isAnonymous: boolish.optional(),
    quote: z.string().trim().min(10).max(1200).optional(),
    rating: z.coerce.number().int().min(1).max(5).optional(),
    isActive: boolish.optional(),
    showOnHome: boolish.optional(),
    sortOrder: z.coerce.number().int().min(0).max(9999).optional(),
    keepImages: z.string().optional(),
  }),
});

export const testimonialIdParamSchema = z.object({
  params: z.object({
    id: mongoObjectId,
  }),
});
