import { z } from 'zod';

const objectIdString = z
  .string()
  .trim()
  .regex(/^[a-fA-F0-9]{24}$/, 'Invalid ID format');

const customFieldAnswerSchema = z.object({
  label: z.string().trim().min(1).max(120),
  value: z.string().trim().min(1).max(500),
});

export const addToCartBodySchema = z.object({
  productId: objectIdString,
  variant: z.object({
    size: z.string().trim().max(80).optional(),
    color: z.string().trim().max(80).optional(),
    colorCode: z.string().trim().max(20).optional(),
    sku: z.string().trim().min(1).max(120),
  }),
  quantity: z.coerce.number().int().min(1).max(10),
  customFieldAnswers: z.array(customFieldAnswerSchema).max(20).optional(),
  idempotencyKey: z.string().trim().min(8).max(128).optional(),
});

export const updateCartItemBodySchema = z.object({
  quantity: z.coerce.number().int().min(1).max(10),
  idempotencyKey: z.string().trim().min(8).max(128).optional(),
});

export const updateCartItemParamsSchema = z.object({
  cartItemId: z.string().trim().min(1).max(64),
});

export const applyCouponBodySchema = z.object({
  couponCode: z.string().trim().min(1).max(40),
  idempotencyKey: z.string().trim().min(8).max(128).optional(),
});

export const addToCartSchema = z.object({
  body: addToCartBodySchema,
});

export const updateCartItemSchema = z.object({
  body: updateCartItemBodySchema,
  params: updateCartItemParamsSchema,
});

export const applyCouponSchema = z.object({
  body: applyCouponBodySchema,
});

export const removeFromCartParamsSchema = z.object({
  params: updateCartItemParamsSchema,
});
