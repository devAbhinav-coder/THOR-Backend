import { Types } from "mongoose";
import Blog from "../../models/Blog";
import Product from "../../models/Product";
import { advancedSearchService } from "../advancedSearchService";
import {
  vectorSearchBlogs,
  vectorSearchProducts,
} from "./vectorIndexService";
import {
  BLOG_CATEGORIES,
  plainBlogExcerpt,
} from "../../types/utils/blogContent";

const CATEGORY_CONTEXT: Record<string, string> = {
  "saree-styling": "draping, pleats, pallu, blouse pairing, occasion looks",
  bridal: "wedding, reception, haldi, bridal saree, lehenga alternatives",
  gifting: "corporate gifting, festive hampers, saree gift boxes, personalization",
  "fabric-care": "silk care, storage, ironing, dry clean, banarasi preservation",
  festive: "Diwali, Navratri, Karva Chauth, Durga Puja outfit ideas",
  trends: "seasonal colours, celebrity-inspired drapes, new arrivals styling",
};

const BRAND_VOICE = {
  name: "The House of Rani Journal",
  tone: "warm, expert, conversational — professional English only",
  audience: "Indian women shopping sarees, bridal wear, gifting",
  avoid: [
    "clickbait",
    "keyword stuffing",
    "generic filler",
    "invented product prices",
  ],
};

function currentSeasonContext(): string {
  const month = new Date().getMonth();
  if (month >= 9 || month <= 1) return "festive and wedding season (Oct–Feb)";
  if (month >= 2 && month <= 4) return "spring wedding and summer prep";
  if (month >= 5 && month <= 8) return "monsoon care and pre-festive styling";
  return "year-round ethnic wear";
}

async function searchSimilarBlogs(
  topic: string,
  keywords: string[],
  limit = 5,
) {
  const query = [topic, ...keywords].filter(Boolean).join(" ").trim();
  if (!query) return [];

  try {
    const blogs = await Blog.find(
      { $text: { $search: query }, isPublished: true },
      { score: { $meta: "textScore" } },
    )
      .sort({ score: { $meta: "textScore" } })
      .limit(limit)
      .select("title slug excerpt category tags createdAt")
      .lean();

    return blogs.map((b) => ({
      title: b.title,
      slug: b.slug,
      excerpt: (b as { excerpt?: string }).excerpt || "",
      category: (b as { category?: string }).category,
      tags: (b as { tags?: string[] }).tags || [],
    }));
  } catch {
    const regex = new RegExp(
      keywords.slice(0, 3).join("|") || topic.slice(0, 40),
      "i",
    );
    const blogs = await Blog.find({
      isPublished: true,
      $or: [{ title: regex }, { tags: { $in: keywords } }],
    })
      .limit(limit)
      .select("title slug excerpt category tags content")
      .lean();

    return blogs.map((b) => ({
      title: b.title,
      slug: b.slug,
      excerpt: b.excerpt || plainBlogExcerpt(b.content || "", 160),
      category: b.category,
      tags: b.tags || [],
    }));
  }
}

async function searchRelatedProducts(
  keywords: string[],
  productIds: string[] = [],
) {
  const objectIds = productIds
    .filter((id) => Types.ObjectId.isValid(id))
    .map((id) => new Types.ObjectId(id));

  const fromIds =
    objectIds.length > 0 ?
      await Product.find({ _id: { $in: objectIds }, isActive: true })
        .select("name slug category fabric tags shortDescription price")
        .limit(6)
        .lean()
    : [];

  const query = keywords.slice(0, 4).join(" ").trim();
  let fromSearch: Array<Record<string, unknown>> = [];

  if (query) {
    const result = await advancedSearchService.searchProducts({
      query,
      limit: 6,
      isActive: true,
      useCache: true,
    });
    fromSearch = result.products;
  }

  const seen = new Set<string>();
  const merged = [...fromIds, ...fromSearch].filter((p) => {
    const id = String((p as { _id?: unknown })._id || "");
    if (!id || seen.has(id)) return false;
    seen.add(id);
    return true;
  });

  return merged.slice(0, 6).map((p) => {
    const prod = p as {
      name?: string;
      slug?: string;
      category?: string;
      fabric?: string;
      tags?: string[];
      shortDescription?: string;
      price?: number;
    };
    return {
      name: prod.name,
      slug: prod.slug,
      category: prod.category,
      fabric: prod.fabric,
      tags: (prod.tags || []).slice(0, 5),
      shortDescription: (prod.shortDescription || "").slice(0, 120),
      priceInr: prod.price,
    };
  });
}

function buildKeywordSuggestions(
  topic: string,
  keywords: string[],
  category?: string,
  products: Array<{ tags?: string[]; fabric?: string; category?: string }> = [],
): string[] {
  const fromProducts = products.flatMap((p) => p.tags || []).slice(0, 8);
  const catHints = (CATEGORY_CONTEXT[category || ""] || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const base = [topic, ...keywords, ...fromProducts, ...catHints];
  return [...new Set(base.map((k) => k.toLowerCase().trim()).filter((k) => k.length > 2))].slice(0, 15);
}

async function getTopPerformingBlogSamples(limit = 3) {
  const blogs = await Blog.find({ isPublished: true })
    .sort("-viewCount -createdAt")
    .limit(limit)
    .select("title excerpt content category tags viewCount")
    .lean();
  return blogs.map((b) => ({
    title: b.title,
    excerpt: b.excerpt || plainBlogExcerpt(b.content || "", 120),
    category: b.category,
    tags: b.tags || [],
    viewCount: b.viewCount,
    toneHint: "high-performing editorial style",
  }));
}

export async function buildBlogRagContext(input: {
  topic: string;
  keywords?: string[];
  category?: string;
  linkProductIds?: string[];
  tone?: string;
  targetLength?: "short" | "medium" | "long";
}): Promise<Record<string, unknown>> {
  const topic = String(input.topic || "").trim();
  const keywords = (input.keywords || [])
    .map((k) => String(k).trim().toLowerCase())
    .filter(Boolean)
    .slice(0, 12);

  const query = [topic, ...keywords].join(" ");
  const [vectorBlogs, vectorProducts, textBlogs, searchProducts, topSamples] =
    await Promise.all([
      vectorSearchBlogs(query, 5).catch(() => []),
      vectorSearchProducts(query, 6).catch(() => []),
      searchSimilarBlogs(topic, keywords),
      searchRelatedProducts(keywords, input.linkProductIds || []),
      getTopPerformingBlogSamples(3),
    ]);

  const similarBlogs =
    vectorBlogs.length > 0 ?
      vectorBlogs.map((b) => ({ ...b, retrieval: "vector" as const }))
    : textBlogs.map((b) => ({ ...b, retrieval: "text" as const }));

  const seenProductSlugs = new Set<string>();
  const relatedProducts = [...vectorProducts, ...searchProducts].filter((p) => {
    const slug = String((p as { slug?: string }).slug || "");
    if (!slug || seenProductSlugs.has(slug)) return false;
    seenProductSlugs.add(slug);
    return true;
  }).slice(0, 6);

  const keywordSuggestions = buildKeywordSuggestions(
    topic,
    keywords,
    input.category,
    relatedProducts,
  );

  const duplicateWarnings = similarBlogs
    .filter((b) => {
      const t = topic.toLowerCase();
      const bt = b.title.toLowerCase();
      return bt.includes(t.slice(0, 20)) || t.includes(bt.slice(0, 20));
    })
    .map((b) => `Similar published post: "${b.title}" (/blog/${b.slug})`);

  return {
    brandVoice: BRAND_VOICE,
    season: currentSeasonContext(),
    topic,
    keywords,
    category: input.category || "saree-styling",
    categoryContext: CATEGORY_CONTEXT[input.category || "saree-styling"] || "",
    allowedCategories: BLOG_CATEGORIES,
    tone: input.tone || BRAND_VOICE.tone,
    targetLength: input.targetLength || "medium",
    retrievalMethod: vectorBlogs.length > 0 ? "vector+text" : "text",
    similarPublishedBlogs: similarBlogs,
    topPerformingBlogSamples: topSamples,
    keywordSuggestions,
    duplicateWarnings,
    relatedProducts,
    internalLinkBase: process.env.FRONTEND_URL || "https://thehouseofrani.com",
    writingRules: [
      "800-1200 words for medium length",
      "Use keywords naturally in title, first paragraph, and one H2",
      "Include 2-3 internal product links as HTML anchors",
      "Unique angle — do not repeat similarPublishedBlogs topics",
      "Safe HTML only: p, h2, h3, ul, ol, li, strong, em, a, br",
    ],
  };
}

/** Compact context for Groq — keeps TPM low. */
export function compactBlogRagContext(ctx: Record<string, unknown>): Record<string, unknown> {
  return {
    topic: ctx.topic,
    keywords: ctx.keywords,
    category: ctx.category,
    categoryContext: ctx.categoryContext,
    tone: ctx.tone,
    targetLength: ctx.targetLength,
    season: ctx.season,
    keywordSuggestions: (ctx.keywordSuggestions as string[])?.slice(0, 10),
    duplicateWarnings: ctx.duplicateWarnings,
    similarPublishedBlogs: (ctx.similarPublishedBlogs as unknown[])?.slice(0, 3),
    topPerformingBlogSamples: (ctx.topPerformingBlogSamples as unknown[])?.slice(0, 2),
    relatedProducts: (ctx.relatedProducts as unknown[])?.slice(0, 4),
    retrievalMethod: ctx.retrievalMethod,
    allowedCategories: ctx.allowedCategories,
  };
}

export async function findRelatedBlogs(
  blogId: Types.ObjectId,
  tags: string[] = [],
  category?: string,
  limit = 4,
) {
  const baseFilter = { isPublished: true, _id: { $ne: blogId } };

  if (tags.length > 0) {
    const byTags = await Blog.find({ ...baseFilter, tags: { $in: tags } })
      .sort("-viewCount -createdAt")
      .limit(limit)
      .select(
        "title slug excerpt images readingTimeMin category tags createdAt viewCount",
      )
      .populate("author", "name avatar")
      .lean();
    if (byTags.length >= limit) return byTags;
  }

  if (category) {
    const byCat = await Blog.find({ ...baseFilter, category })
      .sort("-viewCount -createdAt")
      .limit(limit)
      .select(
        "title slug excerpt images readingTimeMin category tags createdAt viewCount",
      )
      .populate("author", "name avatar")
      .lean();
    if (byCat.length > 0) return byCat;
  }

  return Blog.find(baseFilter)
    .sort("-createdAt")
    .limit(limit)
    .select(
      "title slug excerpt images readingTimeMin category tags createdAt viewCount",
    )
    .populate("author", "name avatar")
    .lean();
}
