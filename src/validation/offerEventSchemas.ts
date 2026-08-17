import { z } from 'zod';

export const recordOfferEventBodySchema = z.object({
  eventType: z.enum(['popup_impression', 'popup_dismiss', 'popup_cta_click', 'coupon_copy']),
  offerKind: z.enum(['coupon', 'sale', 'promotion']),
  offerId: z.string().trim().max(64).optional(),
  offerLabel: z.string().trim().max(200).optional(),
  sessionKey: z.string().trim().min(8).max(128),
  path: z.string().trim().max(300).optional(),
});

export const recordOfferEventSchema = z.object({
  body: recordOfferEventBodySchema,
});
