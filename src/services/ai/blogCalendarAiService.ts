import { createHash } from "crypto";
import { blogAiConfig } from "../../config/ai";
import AppError from "../../types/utils/AppError";
import { getCache, setCache } from "../cacheService";
import { aiConfig } from "../../config/ai";
import { AI_ENGLISH_ONLY_RULE } from "./aiPromptConstants";
import { blogChatCompletion } from "./blogLlmClient";
import { parseJsonFromModel } from "./groqClient";
import { buildBlogCalendarContext } from "./blogCalendarContextBuilder";

export type BlogCalendarPlanItem = {
  topic: string;
  keywords: string[];
  category: string;
  plannedDate: string;
  notes: string;
  trendScore: number;
  trendReason: string;
  festivalHook?: string;
};

export type BlogCalendarPlanResult = {
  summary: string;
  items: BlogCalendarPlanItem[];
  model: string;
  cached: boolean;
  generatedAt: string;
};

type RawPlan = {
  summary?: string;
  items?: Array<{
    topic?: string;
    keywords?: string[];
    category?: string;
    plannedDate?: string;
    notes?: string;
    trendScore?: number;
    trendReason?: string;
    festivalHook?: string;
  }>;
};

function cacheHash(s: string): string {
  return createHash("sha256").update(s).digest("hex").slice(0, 16);
}

function nextPublishDates(count: number, weeks: number): string[] {
  const dates: string[] = [];
  const start = new Date();
  start.setDate(start.getDate() + 3);
  const intervalDays = Math.max(3, Math.floor((weeks * 7) / count));

  for (let i = 0; i < count; i++) {
    const d = new Date(start);
    d.setDate(d.getDate() + i * intervalDays);
    dates.push(d.toISOString().slice(0, 10));
  }
  return dates;
}

function normalizeItems(
  raw: RawPlan,
  weeks: number,
): BlogCalendarPlanItem[] {
  const fallbackDates = nextPublishDates(
    Math.max(4, Math.min(8, weeks * 2)),
    weeks,
  );

  return (raw.items || [])
    .map((item, i) => {
      const topic = String(item.topic || "").trim();
      if (topic.length < 8) return null;

      const keywords = (item.keywords || [])
        .map((k) => String(k).trim().toLowerCase())
        .filter(Boolean)
        .slice(0, 8);

      return {
        topic: topic.slice(0, 280),
        keywords: keywords.length ? keywords : [topic.split(" ")[0]].filter(Boolean),
        category: String(item.category || "saree-styling").slice(0, 40),
        plannedDate: item.plannedDate?.slice(0, 10) || fallbackDates[i] || fallbackDates[0],
        notes: String(item.notes || item.trendReason || "").slice(0, 500),
        trendScore: Math.min(100, Math.max(0, Number(item.trendScore) || 70)),
        trendReason: String(item.trendReason || "Seasonal ethnic wear interest").slice(0, 200),
        festivalHook: item.festivalHook ? String(item.festivalHook).slice(0, 120) : undefined,
      };
    })
    .filter((x): x is BlogCalendarPlanItem => Boolean(x))
    .slice(0, weeks * 2);
}

export async function generateBlogCalendarPlan(input: {
  weeks?: number;
  focus?: string;
  postsPerWeek?: number;
  regenerate?: boolean;
}): Promise<BlogCalendarPlanResult> {
  const weeks = Math.min(8, Math.max(2, input.weeks ?? 4));
  const postsPerWeek = Math.min(2, Math.max(1, input.postsPerWeek ?? 1));
  const totalPosts = weeks * postsPerWeek;

  const ctx = await buildBlogCalendarContext({ weeks, focus: input.focus });

  const cacheKey = `ai:blog:calendar:v1:${cacheHash(JSON.stringify({ weeks, focus: input.focus, postsPerWeek }))}`;
  if (!input.regenerate) {
    const cached = await getCache<BlogCalendarPlanResult>(cacheKey);
    if (cached?.items?.length) return { ...cached, cached: true };
  }

  const startDate = new Date();
  startDate.setDate(startDate.getDate() + 2);

  const prompt = `You are the content strategist for The House of Rani (Indian ethnic wear e-commerce).

Create a ${weeks}-week blog content calendar (${totalPosts} posts total, ~${postsPerWeek}/week).
Use trendSeeds + upcomingFestivals as Google-search-intent proxy for India.
Avoid topics in existingPublishedTopics and alreadyPlannedTopics.

Return ONLY valid JSON:
{
  "summary": "2-3 sentence plan overview in professional English",
  "items": [
    {
      "topic": "SEO headline 8-120 chars",
      "keywords": ["kw1", "kw2", "kw3"],
      "category": "one of allowedCategories",
      "plannedDate": "YYYY-MM-DD",
      "notes": "why this topic now + angle for shop",
      "trendScore": 75,
      "trendReason": "e.g. Diwali prep searches rising / monsoon care trend",
      "festivalHook": "optional festival name"
    }
  ]
}

Schedule posts from ${startDate.toISOString().slice(0, 10)} across ${weeks} weeks (spread evenly, Tue/Thu/Sat preferred).
${input.focus ? `Focus area: ${input.focus}` : ""}
${AI_ENGLISH_ONLY_RULE}

CONTEXT:
${JSON.stringify(ctx)}`;

  const { text, model } = await blogChatCompletion(prompt, {
    systemExtra:
      "JSON only. Exactly the requested number of items. Unique topics. Indian SEO intent. English only.",
    maxTokens: blogAiConfig.provider === "gemini" ? 4096 : 2800,
    maxPromptChars: 16000,
    jsonObject: true,
  });

  const parsed = parseJsonFromModel<RawPlan>(text);
  let items = normalizeItems(parsed || {}, weeks);

  if (items.length < Math.min(3, totalPosts)) {
    throw new AppError(
      "Calendar plan incomplete — wait a minute and click Generate Plan again.",
      502,
    );
  }

  const payload: BlogCalendarPlanResult = {
    summary: String(parsed?.summary || "AI content calendar ready.").slice(0, 600),
    items,
    model,
    cached: false,
    generatedAt: new Date().toISOString(),
  };

  setCache(cacheKey, payload, aiConfig.draftCacheTtlSec).catch(() => {});
  return payload;
}
