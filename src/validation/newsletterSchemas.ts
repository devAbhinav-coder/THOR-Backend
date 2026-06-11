import { z } from "zod";

export const subscribeNewsletterSchema = z.object({
  body: z.object({
    email: z
      .string()
      .email("Please enter a valid email address")
      .max(120)
      .transform((s) => s.trim().toLowerCase()),
    source: z.enum(["blog_listing", "blog_detail"]).optional().default("blog_listing"),
  }),
});

export const adminNewsletterListQuerySchema = z.object({
  query: z.object({
    page: z.coerce.number().int().min(1).optional().default(1),
    limit: z.coerce.number().int().min(1).max(100).optional().default(20),
    search: z.string().max(120).optional(),
    active: z
      .enum(["true", "false", "all"])
      .optional()
      .default("all"),
  }),
});
