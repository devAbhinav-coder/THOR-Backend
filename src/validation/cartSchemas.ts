import { z } from 'zod';
import { CART_LINE_QTY_MAX } from '../constants/cartLimits';

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
  quantity: z.coerce.number().int().min(1).max(CART_LINE_QTY_MAX),
  customFieldAnswers: z.array(customFieldAnswerSchema).max(20).optional(),
  idempotencyKey: z.string().trim().min(8).max(128).optional(),
});

export const updateCartItemBodySchema = z.object({
  quantity: z.coerce.number().int().min(1).max(CART_LINE_QTY_MAX),
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

const promotionPreviewLineSchema = z.object({
  productId: objectIdString,
  price: z.coerce.number().min(0),
  quantity: z.coerce.number().int().min(1).max(CART_LINE_QTY_MAX),
});

export const previewCartPromotionBodySchema = z.object({
  items: z.array(promotionPreviewLineSchema).min(1).max(50),
});

const buyNowPreviewLineSchema = z.object({
  productId: objectIdString,
  variant: z.object({
    size: z.string().trim().max(80).optional(),
    color: z.string().trim().max(80).optional(),
    colorCode: z.string().trim().max(20).optional(),
    sku: z.string().trim().min(1).max(120),
  }),
  quantity: z.coerce.number().int().min(1).max(CART_LINE_QTY_MAX),
});

export const previewBuyNowCheckoutBodySchema = z.object({
  productId: objectIdString,
  variant: buyNowPreviewLineSchema.shape.variant,
  quantity: buyNowPreviewLineSchema.shape.quantity,
});

export const previewBuyNowCheckoutSchema = z.object({
  body: previewBuyNowCheckoutBodySchema,
});

export const previewCartPromotionSchema = z.object({
  body: previewCartPromotionBodySchema,
});
