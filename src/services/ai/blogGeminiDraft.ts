import { blogAiConfig } from "../../config/ai";
import logger from "../../types/utils/logger";
import { AI_ENGLISH_ONLY_RULE } from "./aiPromptConstants";
import { blogChatCompletion } from "./blogLlmClient";
import {
  normalizeBlogDraft,
  salvageBlogContentFromTruncated,
  type BlogDraftNormalized,
} from "./blogDraftNormalize";
import { parseJsonFromModel } from "./groqClient";
import {
  computeReadingTimeMin,
  plainBlogExcerpt,
  enrichBlogContentHtml,
  sanitizeBlogHtml,
} from "../../types/utils/blogContent";

function geminiWordTarget(targetLength?: "short" | "medium" | "long"): string {
  if (targetLength === "short") return "350-450";
  if (targetLength === "long") return "600-750";
  return "450-550";
}

/** Two Gemini calls — metadata JSON + content JSON — avoids MAX_TOKENS on one huge blob. */
export async function draftBlogWithGemini(input: {
  topic: string;
  tone?: string;
  category?: string;
  targetLength?: "short" | "medium" | "long";
  compactCtx: Record<string, unknown>;
}): Promise<{ norm: BlogDraftNormalized; model: string }> {
  const { topic, tone, category, targetLength, compactCtx } = input;
  const wordTarget = geminiWordTarget(targetLength);
  const products = (compactCtx.relatedProducts as unknown[]) || [];

  const metaPrompt = `Return JSON for The House of Rani blog metadata. Do NOT include a "content" field.

{
  "titleOptions": ["headline 1", "headline 2", "headline 3"],
  "title": "best pick",
  "slug": "url-friendly-slug",
  "excerpt": "150-200 char teaser",
  "seoTitle": "50-60 chars",
  "seoDescription": "140-160 chars",
  "keywords": ["6-8 keywords"],
  "tags": ["4-5 tags"],
  "category": "from allowedCategories",
  "suggestedImageCaptions": ["caption 1", "caption 2"],
  "internalLinks": [{ "productSlug": "from relatedProducts", "anchorText": "text" }]
}

Topic: ${topic}
Tone: ${tone || "warm expert"}
Category hint: ${category || "saree-styling"}
${AI_ENGLISH_ONLY_RULE}
CONTEXT: ${JSON.stringify(compactCtx)}`;

  const metaResult = await blogChatCompletion(metaPrompt, {
    systemExtra: "Valid JSON only. No content field. No markdown fences.",
    maxTokens: 2048,
    maxPromptChars: 14000,
    jsonObject: true,
  });

  const metaNorm = normalizeBlogDraft(metaResult.text, topic);

  const contentPrompt = `Return JSON with ONE field only:
{"content": "<p>Opening paragraph</p><blockquote><p>One editorial pull-quote here</p></blockquote><h2>Section One</h2><p>...</p><h2>Section Two</h2><p>...</p><h2>Section Three</h2><p>...</p>"}

Write the HTML body for blog: "${topic}"
Target ${wordTarget} words. Exactly 3 <h2> sections.
Include exactly ONE <blockquote><p>...</p></blockquote> pull-quote after the opening paragraph.
Do NOT wrap normal sentences in quotation marks. No fake quotes in every paragraph.
Include 2 product links <a href='/shop/SLUG'>anchor</a> from: ${JSON.stringify(products)}
Tone: ${tone || "warm expert"}. Allowed tags only: p, h2, ul, ol, li, strong, em, a, blockquote.
${AI_ENGLISH_ONLY_RULE}`;

  const contentResult = await blogChatCompletion(contentPrompt, {
    systemExtra: "JSON with single content field. Complete valid HTML inside content.",
    maxTokens: 8192,
    maxPromptChars: 8000,
    jsonObject: true,
  });

  let content =
    parseJsonFromModel<{ content?: string }>(contentResult.text)?.content || "";

  if (contentResult.truncated || content.length < 120) {
    content = salvageBlogContentFromTruncated(contentResult.text);
  }
  content = enrichBlogContentHtml(content);

  if (content.length < 120) {
    logger.warn("Gemini content phase short — retrying with 300-400 word target");
    const shortPrompt = `Return JSON: {"content": "HTML blog body"}
Topic: "${topic}". Only 300-400 words, 2 <h2> sections, 1 product link.
Products: ${JSON.stringify(products.slice(0, 2))}
${AI_ENGLISH_ONLY_RULE}`;

    const retry = await blogChatCompletion(shortPrompt, {
      systemExtra: "JSON only. Short article.",
      maxTokens: 4096,
      maxPromptChars: 5000,
      jsonObject: true,
    });
    content =
      parseJsonFromModel<{ content?: string }>(retry.text)?.content ||
      salvageBlogContentFromTruncated(retry.text);
    content = enrichBlogContentHtml(content);
  }

  const excerpt =
    metaNorm.excerpt || plainBlogExcerpt(content, 180).slice(0, 220);

  const norm: BlogDraftNormalized = {
    ...metaNorm,
    content,
    excerpt,
    seoDescription:
      metaNorm.seoDescription || excerpt.slice(0, 170),
    readingTimeMin: computeReadingTimeMin(content),
  };

  return { norm, model: blogAiConfig.model };
}
