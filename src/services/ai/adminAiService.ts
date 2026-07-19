import { createHash } from "crypto";
import AppError from "../../types/utils/AppError";
import logger from "../../types/utils/logger";
import { getCache, setCache } from "../cacheService";
import { aiConfig, blogAiConfig } from "../../config/ai";
import {
  buildFormattedAiFields,
  groqChatCompletion,
  groqChatWithHistory,
  parseJsonFromModel,
  type GroqMessage,
} from "./groqClient";
import { blogChatCompletion } from "./blogLlmClient";
import { normalizeProductDraft } from "./productDraftNormalize";
import { enrichProductDraft } from "./productDraftEnrich";
import { normalizeMarketingEmailDraft } from "./marketingDraftNormalize";
import type { ProductVariantInput } from "./adminAiContextBuilder";
import {
  isTimeSensitiveQuestion,
  tryResolveAdminQuestion,
  type AskStoreContext,
} from "./adminAiAskResolver";
import {
  buildAskStoreContext,
  buildDashboardContext,
  buildMarketingDraftContext,
  buildOrderContext,
  buildProductDraftContext,
  buildReturnsContext,
  buildReviewDraftContext,
  buildUserContext,
  computeRuleBasedActions,
  buildSmartActionSummary,
  loadProductById,
} from "./adminAiContextBuilder";
import { buildBlogRagContext, compactBlogRagContext } from "./blogRagContextBuilder";
import { normalizeBlogDraft } from "./blogDraftNormalize";
import { draftBlogWithGemini } from "./blogGeminiDraft";
import { AI_ENGLISH_ONLY_RULE, ASK_STORE_SYSTEM_GUARDRAILS } from "./aiPromptConstants";

export type AiResultPayload = {
  text: string;
  bullets: string[];
  intro?: string;
  cached: boolean;
  generatedAt: string;
  model: string;
};

export type AiChatTurn = { role: "user" | "assistant"; content: string };

function toAiPayload(
  rawText: string,
  model: string,
  cached: boolean,
): AiResultPayload {
  const formatted = buildFormattedAiFields(rawText);
  return {
    text: formatted.text,
    bullets: formatted.bullets,
    intro: formatted.intro,
    cached,
    generatedAt: new Date().toISOString(),
    model,
  };
}

export type ProductDraftPayload = AiResultPayload & {
  shortDescription?: string;
  description?: string;
  seoTitle?: string;
  seoDescription?: string;
  tags?: string[];
  productDetailKeys?: string;
  productDetailValues?: string;
};

export type ReviewDraftPayload = AiResultPayload & { replyText?: string };

export type MarketingDraftPayload = AiResultPayload & {
  subject?: string;
  messageHtml?: string;
};

export type BlogDraftPayload = AiResultPayload & {
  title?: string;
  slug?: string;
  excerpt?: string;
  content?: string;
  seoTitle?: string;
  seoDescription?: string;
  keywords?: string[];
  tags?: string[];
  category?: string;
  readingTimeMin?: number;
  suggestedImageCaptions?: string[];
  internalLinks?: Array<{ productSlug: string; anchorText: string }>;
  duplicateWarnings?: string[];
  titleOptions?: string[];
  keywordSuggestions?: string[];
};

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

function cacheHash(input: string): string {
  return createHash("sha256").update(input).digest("hex").slice(0, 16);
}

async function cachedGroqExplain(
  cacheKey: string,
  ttlSec: number,
  prompt: string,
  systemExtra?: string,
): Promise<AiResultPayload> {
  const cached = await getCache<AiResultPayload>(cacheKey);
  if (cached) return { ...cached, cached: true };

  const { text, model } = await groqChatCompletion(prompt, { systemExtra });
  const payload = toAiPayload(text, model, false);
  setCache(cacheKey, payload, ttlSec).catch(() => {});
  return payload;
}

export function getAiStatus() {
  return {
    enabled: aiConfig.enabled,
    model: aiConfig.model,
    provider: "groq",
    blogEnabled: blogAiConfig.enabled,
    blogProvider: blogAiConfig.provider,
    blogModel: blogAiConfig.model,
    features: [
      "daily-brief",
      "action-suggestions",
      "explain-order",
      "explain-user",
      "explain-returns",
      "draft-product",
      "draft-catalog-seo",
      "draft-review-reply",
      "draft-marketing-email",
      "draft-blog",
      "blog-calendar-plan",
      "ask-store",
    ],
  };
}

/** Tier 1 — Daily business pulse (global cache per day) */
export async function getDailyBrief(force = false): Promise<AiResultPayload> {
  const cacheKey = `ai:admin:daily-brief:${todayKey()}`;
  if (!force) {
    const cached = await getCache<AiResultPayload>(cacheKey);
    if (cached) return { ...cached, cached: true };
  }

  const ctx = await buildDashboardContext();
  const prompt = `Using ONLY the store JSON below, write today's executive briefing for the store owner.

OUTPUT FORMAT (strict):
Line 1: One concise summary sentence (no bullet).
Line 2: blank line
Line 3+: Each bullet on its own line, starting with "• ", with real numbers from the JSON.

Cover: today's revenue and orders, month-to-date trend, gross profit and margin, operating costs MTD, stock alerts, fulfilment queue, and one merchandising recommendation grounded in the data. Use the finance object for profit and costs.
${AI_ENGLISH_ONLY_RULE}

JSON:
${JSON.stringify(ctx)}`;

  const { text, model } = await groqChatCompletion(prompt, {
    systemExtra:
      "Use newline-separated bullets. Never combine bullets into one paragraph. English only.",
  });

  const payload = toAiPayload(text, model, false);
  await setCache(cacheKey, payload, aiConfig.dailyBriefTtlSec);
  return payload;
}

/** Tier 1 — Rule-based actions + compact finance summary (no duplicate Groq polish) */
export async function getActionSuggestions(): Promise<{
  rules: ReturnType<typeof computeRuleBasedActions>;
  summary: AiResultPayload | null;
}> {
  const ctx = await buildDashboardContext();
  const rules = computeRuleBasedActions(ctx);
  const local = buildSmartActionSummary(ctx, rules);
  const summary: AiResultPayload = {
    text: local.text,
    bullets: local.bullets,
    intro: local.intro,
    cached: false,
    generatedAt: new Date().toISOString(),
    model: "rules+finance",
  };
  return { rules, summary };
}

export async function explainOrder(orderId: string): Promise<AiResultPayload> {
  let ctx: Record<string, unknown>;
  try {
    ctx = await buildOrderContext(orderId);
  } catch {
    throw new AppError("Order not found.", 404);
  }

  const cacheKey = `ai:admin:explain:order:${orderId}:${cacheHash(JSON.stringify(ctx))}`;
  return cachedGroqExplain(
    cacheKey,
    aiConfig.explainCacheTtlSec,
    `Explain this order for the admin: risks, next steps, return/refund notes if any.
FORMAT: 1 intro line, then 4-6 bullets each on a new line starting with "• ".
${AI_ENGLISH_ONLY_RULE}
JSON:
${JSON.stringify(ctx)}`,
  );
}

export async function explainUser(userId: string): Promise<AiResultPayload> {
  let ctx: Record<string, unknown>;
  try {
    ctx = await buildUserContext(userId);
  } catch {
    throw new AppError("User not found.", 404);
  }

  const cacheKey = `ai:admin:explain:user:${userId}:${cacheHash(JSON.stringify(ctx.metrics))}`;
  return cachedGroqExplain(
    cacheKey,
    aiConfig.explainCacheTtlSec,
    `Advise the admin how to treat this customer (loyalty, risk, support tone). No invented spend.
FORMAT: 1 intro line, then 4-6 bullets each on a new line starting with "• ".
${AI_ENGLISH_ONLY_RULE}
JSON:
${JSON.stringify(ctx)}`,
  );
}

export async function explainReturns(): Promise<AiResultPayload> {
  const ctx = await buildReturnsContext();
  const cacheKey = `ai:admin:explain:returns:${todayKey()}:${cacheHash(JSON.stringify(ctx))}`;
  return cachedGroqExplain(
    cacheKey,
    aiConfig.explainCacheTtlSec,
    `Summarize return trends and what the admin should investigate.
FORMAT: 1 intro line, then 4-6 bullets each on a new line starting with "• ".
${AI_ENGLISH_ONLY_RULE}
JSON:
${JSON.stringify(ctx)}`,
  );
}

/** Tier 2 — Product copy draft (full form: description, SEO, product detail table) */
export async function draftProductCopy(body: {
  name: string;
  category?: string;
  subcategory?: string;
  fabric?: string;
  price?: number;
  comparePrice?: number;
  tags?: string[];
  shortDescription?: string;
  designNotes?: string;
  variants?: ProductVariantInput[];
  productId?: string;
}): Promise<ProductDraftPayload> {
  if (!body.name?.trim()) throw new AppError("Product name is required.", 400);

  const variants = body.variants || [];
  const designNotes = String(body.designNotes || "").trim();
  if (
    designNotes.length < 5 &&
    variants.filter((v) => v.color || v.size).length === 0
  ) {
    throw new AppError(
      "Add design notes (e.g. floral, Banarasi, partner piece) or fill in variant size/color — the AI needs product context.",
      400,
    );
  }

  const base = await buildProductDraftContext({
    name: body.name.trim(),
    category: body.category,
    subcategory: body.subcategory,
    fabric: body.fabric,
    price: body.price,
    comparePrice: body.comparePrice,
    tags: body.tags,
    shortDescription: body.shortDescription,
    designNotes,
    variants,
  });

  if (body.productId) {
    const existing = await loadProductById(body.productId);
    if (existing) Object.assign(base, { existingProduct: existing });
  }

  const fabricFromForm = String(body.fabric || "").trim();
  const cacheKey = `ai:admin:draft:product:v5:${cacheHash(JSON.stringify(base))}`;
  const cached = await getCache<ProductDraftPayload>(cacheKey);
  if (cached?.description && cached?.shortDescription) {
    const norm = enrichProductDraft(
      {
        shortDescription: cached.shortDescription || "",
        description: cached.description || "",
        seoTitle: cached.seoTitle || "",
        seoDescription: cached.seoDescription || "",
        tags: cached.tags || [],
        productDetailKeys: cached.productDetailKeys || "",
        productDetailValues: cached.productDetailValues || "",
      },
      {
        name: body.name.trim(),
        fabric: fabricFromForm,
        category: body.category,
        subcategory: body.subcategory,
        designNotes,
        variants: body.variants,
      },
    );
    return {
      ...cached,
      cached: true,
      shortDescription: norm.shortDescription,
      seoTitle: norm.seoTitle,
      seoDescription: norm.seoDescription,
      tags: norm.tags.length ? norm.tags : cached.tags,
      productDetailKeys: norm.productDetailKeys,
      productDetailValues: norm.productDetailValues,
    };
  }
  const prompt = `Write a complete PDP listing for The House of Rani (Indian ethnic wear).

Use product name + ALL variants (size, color, SKU) + design notes. productInput.fabric is authoritative for the Fabric spec row.

Return ONLY valid JSON:
{
  "shortDescription": "120-220 chars — exactly TWO complete sentences for listing cards (not one short phrase, not the full essay)",
  "description": "plain text: 3 short paragraphs separated by \\n\\n, then 4-6 feature lines each starting with - ",
  "seoTitle": "50-60 chars, include product type + brand-friendly keywords",
  "seoDescription": "140-160 chars, searchable, mentions fabric/motif if known",
  "tags": ["6-8 search tags"],
  "productDetailKeys": "newline-separated — MUST include at least:\\nFabric\\nWork\\nLength\\nBlouse\\nCare",
  "productDetailValues": "newline-separated values — SAME line count as keys. Fabric value MUST match productInput.fabric when set."
}

Rules:
- shortDescription: two sentences, evocative (color, motif, occasion) — different from description opening
- description must NOT be empty; bullets after paragraphs
- productDetailKeys and productDetailValues: equal lines, 5-8 rows
- If productInput.fabric is set, first Fabric value MUST be that exact string
- Length: saree/sari category → "5.5 metres (approx.)" unless notes say otherwise
- Work: from design notes (zari, kalamkari, floral, peacock pallu, etc.)
- Do not invent MRP/discount % unless given
- Plain text only in description (no HTML)
- ${AI_ENGLISH_ONLY_RULE}

INPUT JSON:
${JSON.stringify(base)}`;

  const { text, model } = await groqChatCompletion(prompt, {
    systemExtra:
      "JSON only. shortDescription must be 2 sentences. productDetail table must include Fabric with correct value. English only.",
    maxTokens: 1800,
    jsonObject: true,
  });

  let norm = normalizeProductDraft(text);
  norm = enrichProductDraft(norm, {
    name: body.name.trim(),
    fabric: fabricFromForm,
    category: body.category,
    subcategory: body.subcategory,
    designNotes,
    variants: body.variants,
  });

  if (!norm.description && !norm.shortDescription) {
    throw new AppError(
      "AI could not generate product copy. Try richer design notes and retry.",
      502,
    );
  }

  const payload: ProductDraftPayload = {
    text: norm.description || norm.shortDescription,
    bullets: [],
    cached: false,
    generatedAt: new Date().toISOString(),
    model,
    shortDescription: norm.shortDescription,
    description: norm.description,
    seoTitle: norm.seoTitle,
    seoDescription: norm.seoDescription,
    tags: norm.tags.length ? norm.tags : undefined,
    productDetailKeys: norm.productDetailKeys || undefined,
    productDetailValues: norm.productDetailValues || undefined,
  };

  setCache(cacheKey, payload, aiConfig.draftCacheTtlSec).catch(() => {});
  return payload;
}

export type CatalogSeoDraftPayload = AiResultPayload & {
  metaTitle?: string;
  metaDescription?: string;
};

function normalizeCatalogSeoDraft(raw: string): {
  metaTitle: string;
  metaDescription: string;
} {
  const parsed = parseJsonFromModel<{
    metaTitle?: string;
    metaDescription?: string;
    seoTitle?: string;
    seoDescription?: string;
  }>(raw);
  const metaTitle = String(parsed?.metaTitle || parsed?.seoTitle || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 70);
  const metaDescription = String(
    parsed?.metaDescription || parsed?.seoDescription || "",
  )
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 160);
  return { metaTitle, metaDescription };
}

/** Tier 2 — Category / subcategory SERP meta from collection name */
export async function draftCatalogSeo(body: {
  kind: "category" | "subcategory";
  name: string;
  parentCategoryName?: string;
  description?: string;
}): Promise<CatalogSeoDraftPayload> {
  const name = body.name?.trim();
  if (!name) throw new AppError("Collection name is required.", 400);
  const kind = body.kind === "subcategory" ? "subcategory" : "category";
  const parent = String(body.parentCategoryName || "").trim();
  const description = String(body.description || "").trim();

  const input = { kind, name, parentCategoryName: parent || undefined, description: description || undefined };
  const cacheKey = `ai:admin:draft:catalog-seo:v2:${blogAiConfig.provider}:${cacheHash(JSON.stringify(input))}`;
  const cached = await getCache<CatalogSeoDraftPayload>(cacheKey);
  if (cached?.metaTitle && cached?.metaDescription) {
    return { ...cached, cached: true };
  }

  const pageLabel = kind === "subcategory" ? "subcategory collection page" : "category collection page";
  const prompt = `Write unique SEO meta for a ${pageLabel} on The House of Rani (premium Indian ethnic wear ecommerce, India).

Return ONLY valid JSON:
{
  "metaTitle": "50-60 chars — include the exact collection name + Online India intent. Do NOT include the brand name The House of Rani (site template appends it).",
  "metaDescription": "140-160 chars — unique, benefit-led, India shoppers, mention free delivery over ₹1,099 or 5-day returns once max"
}

Rules:
- metaTitle MUST mention "${name}" clearly (unique per collection — never reuse a generic "Premium Sarees Collection" line)
- If parentCategoryName is set, weave it naturally once in title or description
- No clickbait, no ALL CAPS, no pipe/brand suffix
- ${AI_ENGLISH_ONLY_RULE}

INPUT JSON:
${JSON.stringify(input)}`;

  // Same LLM path as blog drafts — Gemini when GEMINI_API_KEY is set, else Groq.
  const { text, model } = await blogChatCompletion(prompt, {
    systemExtra:
      "JSON only. Unique India ecommerce SEO meta. English only. No brand name in metaTitle.",
    maxTokens: 512,
    jsonObject: true,
  });

  const norm = normalizeCatalogSeoDraft(text);
  if (!norm.metaTitle || !norm.metaDescription) {
    throw new AppError(
      "AI could not generate SEO meta. Check the name and retry.",
      502,
    );
  }

  const payload: CatalogSeoDraftPayload = {
    text: norm.metaTitle,
    bullets: [],
    cached: false,
    generatedAt: new Date().toISOString(),
    model,
    metaTitle: norm.metaTitle,
    metaDescription: norm.metaDescription,
  };

  setCache(cacheKey, payload, aiConfig.draftCacheTtlSec).catch(() => {});
  return payload;
}

/** Tier 2 — Review reply draft */
export async function draftReviewReply(
  reviewId: string,
): Promise<ReviewDraftPayload> {
  let ctx: Record<string, unknown>;
  try {
    ctx = await buildReviewDraftContext(reviewId);
  } catch {
    throw new AppError("Review not found.", 404);
  }

  const cacheKey = `ai:admin:draft:review:${reviewId}`;
  const cached = await getCache<ReviewDraftPayload>(cacheKey);
  if (cached) return { ...cached, cached: true };

  const prompt = `Draft a warm, professional admin reply to this product review for The House of Rani.
Return JSON: { "replyText": "..." } max 400 chars, plain text, no placeholders.
${AI_ENGLISH_ONLY_RULE}
Context:
${JSON.stringify(ctx)}`;

  const { text, model } = await groqChatCompletion(prompt, {
    maxTokens: 500,
    systemExtra: "JSON only with replyText field. English only.",
  });
  const parsed = parseJsonFromModel<{ replyText?: string }>(text);

  const payload: ReviewDraftPayload = {
    text: parsed?.replyText || text,
    bullets: [],
    replyText: (parsed?.replyText || text).slice(0, 500),
    cached: false,
    generatedAt: new Date().toISOString(),
    model,
  };

  setCache(cacheKey, payload, aiConfig.draftCacheTtlSec).catch(() => {});
  return payload;
}

/** Tier 2 — Marketing email draft from admin's own brief */
export async function draftMarketingEmail(body: {
  adminBrief?: string;
  subjectHint?: string;
  audience?: string;
  estimatedRecipients?: number;
  ctaText?: string;
  ctaLink?: string;
  tone?: string;
}): Promise<MarketingDraftPayload> {
  const brief = String(body.adminBrief || "").trim();
  if (brief.length < 10) {
    throw new AppError(
      "Write what the email should say in the Message box first (offer, festival, products, tone — at least 1–2 lines).",
      400,
    );
  }

  const ctx = await buildMarketingDraftContext(body);
  const cacheKey = `ai:admin:draft:email:v3:${cacheHash(JSON.stringify(ctx))}`;
  const cached = await getCache<MarketingDraftPayload>(cacheKey);
  if (cached?.subject && cached?.messageHtml)
    return { ...cached, cached: true };

  const req = ctx.adminRequirements as Record<string, string | number>;
  const prompt = `Write a complete marketing email for The House of Rani.

ADMIN REQUIREMENTS (you MUST follow — do not invent unrelated offers):
"""
${brief}
"""

Subject hint from admin: "${req.subjectHint || ""}"
Audience: ${req.audience}
Recipients estimate: ${req.estimatedRecipients}
CTA button text: "${req.ctaText}" linking to ${req.ctaLink}
Tone: ${req.tone}

Return ONLY valid JSON:
{ "subject": "max 70 chars", "messageHtml": "<p>...</p>" }

Rules for messageHtml:
- 2-4 short paragraphs in <p> tags only (optional <strong> for emphasis)
- Reflect EXACTLY what admin asked in the brief (sale, collection, festival, etc.)
- Warm Indian ethnic wear brand voice; ${AI_ENGLISH_ONLY_RULE}
- End with a clear CTA line mentioning the button
- No fake coupon codes unless admin wrote them
- Do not use markdown ** — HTML only inside messageHtml`;

  const { text, model } = await groqChatCompletion(prompt, {
    maxTokens: 900,
    jsonObject: true,
    systemExtra:
      'Return ONLY one JSON object with keys "subject" and "messageHtml". No markdown fences or extra text.',
  });

  const norm = normalizeMarketingEmailDraft(text, {
    subjectHint: body.subjectHint,
  });

  if (!norm.messageHtml || norm.messageHtml.length < 20) {
    throw new AppError(
      "AI could not generate the email body. Add more detail in the Message box (offer, dates, products) and try again.",
      502,
    );
  }

  const payload: MarketingDraftPayload = {
    text: norm.subject,
    bullets: [],
    subject: norm.subject,
    messageHtml: norm.messageHtml,
    cached: false,
    generatedAt: new Date().toISOString(),
    model,
  };

  setCache(cacheKey, payload, aiConfig.draftCacheTtlSec).catch(() => {});
  return payload;
}

/** Tier 2 — SEO blog draft with RAG context */
export async function draftBlogPost(body: {
  topic: string;
  keywords?: string[];
  category?: string;
  tone?: string;
  targetLength?: "short" | "medium" | "long";
  linkProductIds?: string[];
  includeProductLinks?: boolean;
  regenerate?: boolean;
}): Promise<BlogDraftPayload> {
  const topic = String(body.topic || "").trim();
  if (topic.length < 8) {
    throw new AppError(
      "Topic must be at least 8 characters — e.g. Banarasi saree wedding styling tips",
      400,
    );
  }

  const ctx = await buildBlogRagContext({
    topic,
    keywords: body.keywords,
    category: body.category,
    tone: body.tone,
    targetLength: body.targetLength,
    linkProductIds: body.linkProductIds,
  });

  const cacheKey = `ai:admin:draft:blog:v3:${cacheHash(JSON.stringify({ topic, keywords: body.keywords, category: body.category, tone: body.tone, linkProductIds: body.linkProductIds, provider: blogAiConfig.provider }))}`;
  if (!body.regenerate) {
    const cached = await getCache<BlogDraftPayload>(cacheKey);
    if (cached?.content && cached.title) {
      return { ...cached, cached: true };
    }
  }

  const wordTarget =
    body.targetLength === "short" ? "450-600"
    : body.targetLength === "long" ? "900-1100"
    : "650-850";

  const compactCtx = compactBlogRagContext(ctx);

  if (blogAiConfig.provider === "gemini") {
    const { norm, model } = await draftBlogWithGemini({
      topic,
      tone: body.tone,
      category: body.category,
      targetLength: body.targetLength,
      compactCtx,
    });

    if (!norm.content || norm.content.length < 120) {
      throw new AppError(
        "Blog draft failed — Gemini returned an empty response. Wait a minute and click Regenerate.",
        502,
      );
    }

    const duplicateWarnings = (ctx.duplicateWarnings as string[]) || [];
    const payload: BlogDraftPayload = {
      text: norm.excerpt,
      bullets: norm.suggestedImageCaptions.map((c) => `• ${c}`),
      title: norm.title,
      slug: norm.slug,
      excerpt: norm.excerpt,
      content: norm.content,
      seoTitle: norm.seoTitle,
      seoDescription: norm.seoDescription,
      keywords: norm.keywords,
      tags: norm.tags,
      category: norm.category,
      readingTimeMin: norm.readingTimeMin,
      suggestedImageCaptions: norm.suggestedImageCaptions,
      internalLinks: norm.internalLinks,
      duplicateWarnings,
      titleOptions: norm.titleOptions,
      keywordSuggestions: (ctx.keywordSuggestions as string[]) || [],
      cached: false,
      generatedAt: new Date().toISOString(),
      model,
    };

    setCache(cacheKey, payload, aiConfig.draftCacheTtlSec).catch(() => {});
    return payload;
  }

  const prompt = `Write a journal article for The House of Rani (Indian ethnic wear).

Return ONLY valid JSON:
{
  "titleOptions": ["headline 1", "headline 2", "headline 3"],
  "title": "best pick from titleOptions",
  "slug": "url-friendly-slug",
  "excerpt": "150-200 chars teaser",
  "content": "HTML: <p> intro </p> then 3 <h2> sections with <p> and optional <ul>. Include 2 <a href='/shop/SLUG'> links from relatedProducts. Target ${wordTarget} words total.",
  "seoTitle": "50-60 chars",
  "seoDescription": "140-160 chars",
  "keywords": ["6-8 keywords"],
  "tags": ["4-5 tags"],
  "category": "from allowedCategories",
  "suggestedImageCaptions": ["caption 1", "caption 2"],
  "internalLinks": [{ "productSlug": "from relatedProducts", "anchorText": "text" }]
}

Tone: ${body.tone || "warm expert"}. ${AI_ENGLISH_ONLY_RULE}
No invented product slugs or prices. Unique vs similarPublishedBlogs. Keywords natural, not stuffed.

CONTEXT:
${JSON.stringify(compactCtx)}`;

  let text = "";
  let model = blogAiConfig.model;

  const blogLlmOpts = {
    systemExtra:
      "Return valid JSON only. content field must contain safe HTML with p, h2, h3, ul, li, strong, a tags.",
    maxTokens: 3200,
    maxPromptChars: 12000,
    jsonObject: true as const,
  };

  try {
    const result = await blogChatCompletion(prompt, blogLlmOpts);
    text = result.text;
    model = result.model;
  } catch (e) {
    if (e instanceof AppError && e.statusCode === 429) throw e;
    logger.warn(`Blog draft primary attempt failed: ${(e as Error).message}`);
  }

  let norm = normalizeBlogDraft(text, topic);

  if (!norm.content || norm.content.length < 200) {
    const retryPrompt = `Write a shorter blog JSON for topic "${topic}". category: ${body.category || "saree-styling"}.
Return JSON with titleOptions (3), title, slug, excerpt, content (HTML, 500-650 words, 3 h2 sections), seoTitle, seoDescription, keywords, tags, category, suggestedImageCaptions, internalLinks.
Products to link: ${JSON.stringify((compactCtx.relatedProducts as unknown[]) || [])}`;

    const retry = await blogChatCompletion(retryPrompt, {
      systemExtra: "JSON only. Shorter article.",
      maxTokens: 2200,
      maxPromptChars: 8000,
      jsonObject: true,
    });
    text = retry.text;
    model = retry.model;
    norm = normalizeBlogDraft(text, topic);
  }

  if (!norm.content || norm.content.length < 120) {
    throw new AppError(
      "Blog draft failed — Groq returned an empty or truncated response. Wait a moment and click Regenerate.",
      502,
    );
  }

  const duplicateWarnings = (ctx.duplicateWarnings as string[]) || [];

  const payload: BlogDraftPayload = {
    text: norm.excerpt,
    bullets: norm.suggestedImageCaptions.map((c) => `• ${c}`),
    title: norm.title,
    slug: norm.slug,
    excerpt: norm.excerpt,
    content: norm.content,
    seoTitle: norm.seoTitle,
    seoDescription: norm.seoDescription,
    keywords: norm.keywords,
    tags: norm.tags,
    category: norm.category,
    readingTimeMin: norm.readingTimeMin,
    suggestedImageCaptions: norm.suggestedImageCaptions,
    internalLinks: norm.internalLinks,
    duplicateWarnings,
    titleOptions: norm.titleOptions,
    keywordSuggestions: (ctx.keywordSuggestions as string[]) || [],
    cached: false,
    generatedAt: new Date().toISOString(),
    model,
  };

  setCache(cacheKey, payload, aiConfig.draftCacheTtlSec).catch(() => {});
  return payload;
}

/** Tier 3 — Natural language ask (supports multi-turn follow-ups) */
export async function askStore(
  question: string,
  history: AiChatTurn[] = [],
): Promise<AiResultPayload> {
  const q = question.trim().slice(0, 500);
  if (q.length < 3) throw new AppError("Question is too short.", 400);

  const ctx = (await buildAskStoreContext()) as AskStoreContext;
  const trimmedHistory = history
    .filter(
      (h) => h.content?.trim() && (h.role === "user" || h.role === "assistant"),
    )
    .slice(-10)
    .map((h) => ({
      role: h.role,
      content: h.content.trim().slice(0, 800),
    }));

  const resolved = tryResolveAdminQuestion(q, ctx);
  if (resolved) {
    return {
      ...resolved,
      cached: false,
      generatedAt: new Date().toISOString(),
      model: "store-data",
    };
  }

  const askSystem = `${ASK_STORE_SYSTEM_GUARDRAILS}\n\nStore context JSON:\n${JSON.stringify(ctx)}`;

  if (trimmedHistory.length === 0 && !isTimeSensitiveQuestion(q)) {
    const cacheKey = `ai:admin:ask:v2:${todayKey()}:${cacheHash(q)}`;
    return cachedGroqExplain(
      cacheKey,
      Math.min(600, aiConfig.explainCacheTtlSec),
      `Admin question: ${q}\n\nAnswer using ONLY the JSON. Direct answer first. Bullets with • on new lines. ${AI_ENGLISH_ONLY_RULE}`,
      askSystem,
    );
  }

  const messages: GroqMessage[] = [
    { role: "system", content: askSystem },
    ...trimmedHistory.map((h) => ({ role: h.role, content: h.content })),
    { role: "user", content: q },
  ];

  const { text, model } = await groqChatWithHistory(messages, {
    maxTokens: 1100,
  });
  return toAiPayload(text, model, false);
}
