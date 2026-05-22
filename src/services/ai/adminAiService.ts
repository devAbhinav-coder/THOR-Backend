import { createHash } from 'crypto';
import AppError from '../../utils/AppError';
import { getCache, setCache } from '../cacheService';
import { aiConfig } from '../../config/ai';
import {
  buildFormattedAiFields,
  groqChatCompletion,
  groqChatWithHistory,
  parseJsonFromModel,
  type GroqMessage,
} from './groqClient';
import { normalizeProductDraft } from './productDraftNormalize';
import { enrichProductDraft } from './productDraftEnrich';
import { normalizeMarketingEmailDraft } from './marketingDraftNormalize';
import type { ProductVariantInput } from './adminAiContextBuilder';
import {
  isTimeSensitiveQuestion,
  tryResolveAdminQuestion,
  type AskStoreContext,
} from './adminAiAskResolver';
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
} from './adminAiContextBuilder';

export type AiResultPayload = {
  text: string;
  bullets: string[];
  intro?: string;
  cached: boolean;
  generatedAt: string;
  model: string;
};

export type AiChatTurn = { role: 'user' | 'assistant'; content: string };

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

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

function cacheHash(input: string): string {
  return createHash('sha256').update(input).digest('hex').slice(0, 16);
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
    provider: 'groq',
    features: [
      'daily-brief',
      'action-suggestions',
      'explain-order',
      'explain-user',
      'explain-returns',
      'draft-product',
      'draft-review-reply',
      'draft-marketing-email',
      'ask-store',
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
  const prompt = `Using ONLY this store JSON, write today's admin briefing for the owner.

REQUIRED FORMAT (exactly):
Line 1: One short summary sentence (no bullet).
Line 2: blank
Lines 3+: Each bullet on its OWN line starting with "• " and include real numbers.

Cover: today's revenue/orders, month trend, gross profit & margin, operating costs MTD, stock alerts, fulfilment queue, one merchandising tip. Use finance object for profit/costs.
JSON:\n${JSON.stringify(ctx)}`;

  const { text, model } = await groqChatCompletion(prompt, {
    systemExtra:
      'You MUST use newline-separated bullets. Never put all bullets in one paragraph.',
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
    model: 'rules+finance',
  };
  return { rules, summary };
}

export async function explainOrder(orderId: string): Promise<AiResultPayload> {
  let ctx: Record<string, unknown>;
  try {
    ctx = await buildOrderContext(orderId);
  } catch {
    throw new AppError('Order not found.', 404);
  }

  const cacheKey = `ai:admin:explain:order:${orderId}:${cacheHash(JSON.stringify(ctx))}`;
  return cachedGroqExplain(
    cacheKey,
    aiConfig.explainCacheTtlSec,
    `Explain this order for admin: risks, next steps, return/refund notes if any.
FORMAT: 1 intro line, then 4-6 bullets each on new line starting with "• ".
JSON:\n${JSON.stringify(ctx)}`,
  );
}

export async function explainUser(userId: string): Promise<AiResultPayload> {
  let ctx: Record<string, unknown>;
  try {
    ctx = await buildUserContext(userId);
  } catch {
    throw new AppError('User not found.', 404);
  }

  const cacheKey = `ai:admin:explain:user:${userId}:${cacheHash(JSON.stringify(ctx.metrics))}`;
  return cachedGroqExplain(
    cacheKey,
    aiConfig.explainCacheTtlSec,
    `Advise admin how to treat this customer (loyalty, risk, support tone). No invented spend.
FORMAT: 1 intro line, then 4-6 bullets each on new line starting with "• ".
JSON:\n${JSON.stringify(ctx)}`,
  );
}

export async function explainReturns(): Promise<AiResultPayload> {
  const ctx = await buildReturnsContext();
  const cacheKey = `ai:admin:explain:returns:${todayKey()}:${cacheHash(JSON.stringify(ctx))}`;
  return cachedGroqExplain(
    cacheKey,
    aiConfig.explainCacheTtlSec,
    `Summarize return trends and what admin should investigate.
FORMAT: 1 intro line, then 4-6 bullets each on new line starting with "• ".
JSON:\n${JSON.stringify(ctx)}`,
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
  if (!body.name?.trim()) throw new AppError('Product name is required.', 400);

  const variants = body.variants || [];
  const designNotes = String(body.designNotes || '').trim();
  if (designNotes.length < 5 && variants.filter((v) => v.color || v.size).length === 0) {
    throw new AppError(
      'Design notes likho (floral, banarasi, partner piece…) ya variant mein size/color bharo — AI ko context chahiye.',
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

  const fabricFromForm = String(body.fabric || '').trim();
  const cacheKey = `ai:admin:draft:product:v5:${cacheHash(JSON.stringify(base))}`;
  const cached = await getCache<ProductDraftPayload>(cacheKey);
  if (cached?.description && cached?.shortDescription) {
    const norm = enrichProductDraft(
      {
        shortDescription: cached.shortDescription || '',
        description: cached.description || '',
        seoTitle: cached.seoTitle || '',
        seoDescription: cached.seoDescription || '',
        tags: cached.tags || [],
        productDetailKeys: cached.productDetailKeys || '',
        productDetailValues: cached.productDetailValues || '',
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

INPUT JSON:
${JSON.stringify(base)}`;

  const { text, model } = await groqChatCompletion(prompt, {
    systemExtra:
      'JSON only. shortDescription must be 2 sentences. productDetail table must include Fabric with correct value.',
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
    throw new AppError('AI could not generate product copy. Try richer design notes and retry.', 502);
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

/** Tier 2 — Review reply draft */
export async function draftReviewReply(reviewId: string): Promise<ReviewDraftPayload> {
  let ctx: Record<string, unknown>;
  try {
    ctx = await buildReviewDraftContext(reviewId);
  } catch {
    throw new AppError('Review not found.', 404);
  }

  const cacheKey = `ai:admin:draft:review:${reviewId}`;
  const cached = await getCache<ReviewDraftPayload>(cacheKey);
  if (cached) return { ...cached, cached: true };

  const prompt = `Draft a warm, professional admin reply to this product review for The House of Rani.
Return JSON: { "replyText": "..." } max 400 chars, plain text, no placeholders.
Context:\n${JSON.stringify(ctx)}`;

  const { text, model } = await groqChatCompletion(prompt, { maxTokens: 500 });
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
  const brief = String(body.adminBrief || '').trim();
  if (brief.length < 10) {
    throw new AppError(
      'Pehle Message box mein likho kya email bhejna hai (offer, festival, product, tone — kam se kam 1-2 lines).',
      400,
    );
  }

  const ctx = await buildMarketingDraftContext(body);
  const cacheKey = `ai:admin:draft:email:v3:${cacheHash(JSON.stringify(ctx))}`;
  const cached = await getCache<MarketingDraftPayload>(cacheKey);
  if (cached?.subject && cached?.messageHtml) return { ...cached, cached: true };

  const req = ctx.adminRequirements as Record<string, string | number>;
  const prompt = `Write a complete marketing email for The House of Rani.

ADMIN REQUIREMENTS (you MUST follow — do not invent unrelated offers):
"""
${brief}
"""

Subject hint from admin: "${req.subjectHint || ''}"
Audience: ${req.audience}
Recipients estimate: ${req.estimatedRecipients}
CTA button text: "${req.ctaText}" linking to ${req.ctaLink}
Tone: ${req.tone}

Return ONLY valid JSON:
{ "subject": "max 70 chars", "messageHtml": "<p>...</p>" }

Rules for messageHtml:
- 2-4 short paragraphs in <p> tags only (optional <strong> for emphasis)
- Reflect EXACTLY what admin asked in the brief (sale, collection, festival, etc.)
- Warm Indian ethnic wear brand; simple Hinglish OK
- End with clear CTA line mentioning the button
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
      'AI could not generate email body. Message box mein thoda detail likho (offer, dates, products) aur dubara try karo.',
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

/** Tier 3 — Natural language ask (supports multi-turn follow-ups) */
export async function askStore(
  question: string,
  history: AiChatTurn[] = [],
): Promise<AiResultPayload> {
  const q = question.trim().slice(0, 500);
  if (q.length < 3) throw new AppError('Question is too short.', 400);

  const ctx = (await buildAskStoreContext()) as AskStoreContext;
  const trimmedHistory = history
    .filter((h) => h.content?.trim() && (h.role === 'user' || h.role === 'assistant'))
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
      model: 'store-data',
    };
  }

  const askSystem = `${SYSTEM_GUARDRAILS_FOR_ASK}\n\nStore context JSON:\n${JSON.stringify(ctx)}`;

  if (trimmedHistory.length === 0 && !isTimeSensitiveQuestion(q)) {
    const cacheKey = `ai:admin:ask:v2:${todayKey()}:${cacheHash(q)}`;
    return cachedGroqExplain(
      cacheKey,
      Math.min(600, aiConfig.explainCacheTtlSec),
      `Admin question (Hinglish/English): ${q}\n\nAnswer using ONLY the JSON. Direct answer first. Bullets with • on new lines.`,
      askSystem,
    );
  }

  const messages: GroqMessage[] = [
    { role: 'system', content: askSystem },
    ...trimmedHistory.map((h) => ({ role: h.role, content: h.content })),
    { role: 'user', content: q },
  ];

  const { text, model } = await groqChatWithHistory(messages, { maxTokens: 1100 });
  return toAiPayload(text, model, false);
}

const SYSTEM_GUARDRAILS_FOR_ASK = `You are Rani Admin AI — senior advisor for The House of Rani admin.
Use ONLY the JSON snapshot (capabilities list shows what exists).

MAPPING:
- Orders/sales ALWAYS include online checkout + offline/POS (offlineMeta) when paid/refunded.
- kal → timePeriods.yesterday (total, online, offline, paymentBreakdown) | aaj → today | mahine → thisMonth
- profit/munafa → profitSummary | kharcha → operatingExpenses | views → topViewedProductsDetailed
- online/offline → channelMix.monthToDate + lifetime | payments → paymentBreakdown / paymentMethodMixLifetime
- NEVER subtract lifetime - month for dates. NEVER invent numbers.

STYLE:
- Admin types casual Hinglish — understand intent.
- First line = direct answer with ₹ and counts.
- Then 3-7 bullets (• each on new line), each citing real fields/products.
- No generic "improve marketing" lists without naming store metrics.
- Missing data → "Yeh data system mein nahi hai" + suggest Admin page path if in JSON.
Follow-ups: answer the latest question using history context only.`;
