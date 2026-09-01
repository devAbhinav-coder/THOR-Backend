import { z } from "zod";

const mongoObjectId = z
  .string()
  .trim()
  .regex(/^[a-fA-F0-9]{24}$/, "Invalid id");

const optionalBoolish = z
  .union([z.boolean(), z.enum(["true", "false"])])
  .optional();

const articleTemplateEnum = z.enum([
  "classic",
  "magazine",
  "minimal",
  "lookbook",
]);

export const createBlogSchema = z.object({
  body: z.object({
    title: z.string().trim().min(3, "Title is required").max(180),
    slug: z.string().trim().max(180).optional(),
    content: z.string().min(20, "Content is too short"),
    excerpt: z.string().trim().max(400).optional(),
    seoTitle: z.string().trim().max(70).optional(),
    seoDescription: z.string().trim().max(170).optional(),
    keywords: z.unknown().optional(),
    tags: z.unknown().optional(),
    category: z.string().trim().max(80).optional(),
    articleTemplate: articleTemplateEnum.optional(),
    relatedProductIds: z.unknown().optional(),
    aiGenerated: optionalBoolish,
    aiPromptSnapshot: z.string().max(500).optional(),
    scheduledPublishAt: z.string().optional().nullable(),
    isPublished: optionalBoolish,
  }),
});

export const updateBlogSchema = z.object({
  params: z.object({
    id: mongoObjectId,
  }),
  body: z
    .object({
      title: z.string().trim().min(3).max(180).optional(),
      slug: z.string().trim().max(180).optional(),
      content: z.string().min(20).optional(),
      excerpt: z.string().trim().max(400).optional(),
      seoTitle: z.string().trim().max(70).optional(),
      seoDescription: z.string().trim().max(170).optional(),
      keywords: z.unknown().optional(),
      tags: z.unknown().optional(),
      category: z.string().trim().max(80).optional(),
      articleTemplate: articleTemplateEnum.optional(),
      relatedProductIds: z.unknown().optional(),
      aiGenerated: optionalBoolish,
      aiPromptSnapshot: z.string().max(500).optional(),
      scheduledPublishAt: z.string().optional().nullable(),
      isPublished: optionalBoolish,
    })
    .refine((b) => Object.keys(b).length > 0, {
      message: "At least one field is required to update",
    }),
});

export const blogIdParamSchema = z.object({
  params: z.object({
    id: mongoObjectId,
  }),
});

export const blogCommentSchema = z.object({
  params: z.object({
    id: mongoObjectId,
  }),
  body: z.object({
    content: z.string().trim().min(2, "Comment is too short").max(1000),
  }),
});

export const blogCommentDeleteSchema = z.object({
  params: z.object({
    id: mongoObjectId,
    commentId: mongoObjectId,
  }),
});
