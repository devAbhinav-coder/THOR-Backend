import { z } from "zod";

const marketingAttributionFields = z
  .object({
    utmSource: z.string().trim().max(120).optional(),
    utmMedium: z.string().trim().max(120).optional(),
    utmCampaign: z.string().trim().max(200).optional(),
    utmContent: z.string().trim().max(200).optional(),
    utmTerm: z.string().trim().max(200).optional(),
    fbclid: z.string().trim().max(200).optional(),
    landingPath: z.string().trim().max(200).optional(),
    capturedAt: z.string().trim().max(40).optional(),
  })
  .optional();

export const recordStoreVisitSchema = z.object({
  body: z.object({
    sessionKey: z.string().trim().min(8).max(64),
    path: z.string().trim().max(200).optional(),
    referrer: z.string().trim().max(500).optional(),
    marketingAttribution: marketingAttributionFields,
  }),
});

export const marketingAttributionBodySchema = marketingAttributionFields;
