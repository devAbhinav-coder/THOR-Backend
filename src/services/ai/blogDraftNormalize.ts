import sanitizeHtml from "sanitize-html";
import { parseJsonFromModel, stripModelJsonWrapper } from "./groqClient";
import {
  computeReadingTimeMin,
  plainBlogExcerpt,
  enrichBlogContentHtml,
  sanitizeBlogHtml,
  slugFromTitle,
} from "../../types/utils/blogContent";

export type BlogDraftRaw = {
  title?: string;
  slug?: string;
  excerpt?: string;
  content?: string;
  seoTitle?: string;
  seoDescription?: string;
  keywords?: string[];
  tags?: string[];
  category?: string;
  suggestedImageCaptions?: string[];
  internalLinks?: Array<{ productSlug?: string; anchorText?: string }>;
  titleOptions?: string[];
};

export type BlogDraftNormalized = {
  title: string;
  slug: string;
  excerpt: string;
  content: string;
  seoTitle: string;
  seoDescription: string;
  keywords: string[];
  tags: string[];
  category: string;
  readingTimeMin: number;
  suggestedImageCaptions: string[];
  internalLinks: Array<{ productSlug: string; anchorText: string }>;
  titleOptions: string[];
};

/** Recover HTML from Gemini JSON cut off by MAX_TOKENS. */
export function salvageBlogContentFromTruncated(raw: string): string {
  const parsed = parseJsonFromModel<{ content?: string }>(raw);
  if (parsed?.content && parsed.content.length > 80) {
    return sanitizeBlogHtml(parsed.content);
  }

  const trimmed = stripModelJsonWrapper(raw);
  const m = trimmed.match(/"content"\s*:\s*"([\s\S]+)/i);
  if (!m) return "";

  let value = m[1]
    .replace(/\\n/g, "\n")
    .replace(/\\r/g, "\r")
    .replace(/\\t/g, "\t")
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, "\\");

  value = value
    .replace(/",\s*"(?:seoTitle|tags|keywords|title)[\s\S]*$/i, "")
    .replace(/"\s*,?\s*}\s*$/i, "")
    .trim();

  if (value.includes("<p") && !value.includes("</p>")) value += "</p>";
  const openH2 = (value.match(/<h2\b/gi) || []).length;
  const closeH2 = (value.match(/<\/h2>/gi) || []).length;
  if (openH2 > closeH2) value += "</h2>";

  return sanitizeBlogHtml(value);
}

function cleanStringArray(arr: unknown, max = 12): string[] {
  if (!Array.isArray(arr)) return [];
  return arr
    .map((x) => String(x).trim().toLowerCase())
    .filter(Boolean)
    .slice(0, max);
}

export function normalizeBlogDraft(
  rawText: string,
  topic: string,
): BlogDraftNormalized {
  const parsed = parseJsonFromModel<BlogDraftRaw>(rawText) || {};

  const title = (parsed.title || topic).trim().slice(0, 150);
  const slug = (parsed.slug || slugFromTitle(title)).slice(0, 120);
  let content = enrichBlogContentHtml(parsed.content || "");
  if (content.length < 80 && rawText.length > 100) {
    content = enrichBlogContentHtml(salvageBlogContentFromTruncated(rawText));
  }
  const excerpt = (parsed.excerpt || plainBlogExcerpt(content, 180)).slice(
    0,
    220,
  );
  const seoTitle = (parsed.seoTitle || title).slice(0, 70);
  const seoDescription = (parsed.seoDescription || excerpt).slice(0, 170);

  const keywords = cleanStringArray(parsed.keywords, 10);
  const tags = cleanStringArray(parsed.tags, 8);
  const category = String(parsed.category || "saree-styling")
    .trim()
    .slice(0, 40);

  const internalLinks = (parsed.internalLinks || [])
    .filter((l) => l?.productSlug && l?.anchorText)
    .map((l) => ({
      productSlug: String(l.productSlug).trim(),
      anchorText: String(l.anchorText).trim().slice(0, 80),
    }))
    .slice(0, 4);

  const suggestedImageCaptions = (parsed.suggestedImageCaptions || [])
    .map((c) =>
      sanitizeHtml(String(c), {
        allowedTags: [],
        allowedAttributes: {},
      }).trim(),
    )
    .filter(Boolean)
    .slice(0, 5);

  const titleOptions = (parsed.titleOptions || [])
    .map((t) => String(t).trim())
    .filter(Boolean)
    .slice(0, 3);
  if (!titleOptions.includes(title)) titleOptions.unshift(title);
  const uniqueTitles = [...new Set(titleOptions)].slice(0, 3);

  return {
    title,
    slug,
    excerpt,
    content,
    seoTitle,
    seoDescription,
    keywords: keywords.length ? keywords : tags.slice(0, 6),
    tags,
    category,
    readingTimeMin: computeReadingTimeMin(content),
    suggestedImageCaptions,
    internalLinks,
    titleOptions: uniqueTitles,
  };
}
