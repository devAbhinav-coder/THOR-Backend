import sanitizeHtml from "sanitize-html";
import { aiConfig, assertAiEnabled } from "../../config/ai";
import AppError from "../../types/utils/AppError";
import logger from "../../types/utils/logger";
import { GROQ_SYSTEM_GUARDRAILS } from "./aiPromptConstants";

export type GroqMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'");
}

/** Preserve line breaks; only collapse spaces/tabs within a line. */
export function sanitizeAiText(raw: string, maxLen = 8000): string {
  return decodeHtmlEntities(
    sanitizeHtml(raw, {
      allowedTags: [],
      allowedAttributes: {},
    }),
  )
    .replace(/\r\n/g, "\n")
    .replace(/[^\S\n]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, maxLen);
}

const BULLET_LINE = /^(?:[-–—•*]|\d+[.)])\s+(.+)$/;

function stripMarkdown(raw: string): string {
  return raw
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .trim();
}

export function parseAiStructuredText(text: string): {
  intro: string;
  bullets: string[];
} {
  const normalized = stripMarkdown(sanitizeAiText(text, 12000));
  if (!normalized) return { intro: "", bullets: [] };

  const lines = normalized
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  const bullets: string[] = [];
  const introParts: string[] = [];

  for (const line of lines) {
    const m = line.match(BULLET_LINE);
    if (m) {
      bullets.push(m[1].trim());
      continue;
    }
    if (line.startsWith("•")) {
      bullets.push(line.replace(/^•\s*/, "").trim());
      continue;
    }
    if (/\s•\s/.test(line)) {
      const parts = line
        .split(/\s*•\s*/)
        .map((p) => p.trim())
        .filter((p) => p.length > 2);
      if (parts.length > 1) {
        bullets.push(...parts);
        continue;
      }
    }
    introParts.push(line);
  }

  if (
    bullets.length === 0 &&
    introParts.length === 1 &&
    introParts[0].length > 100
  ) {
    const chunk = introParts[0];
    const inlineBullets = chunk
      .split(/\s*•\s*/)
      .map((p) => p.trim())
      .filter((p) => p.length > 3);
    if (inlineBullets.length > 1) {
      return { intro: inlineBullets[0], bullets: inlineBullets.slice(1, 10) };
    }
    const sentences = chunk
      .split(/(?<=[.!?।])\s+/)
      .map((s) => s.trim())
      .filter((s) => s.length > 8);
    if (sentences.length >= 3) {
      return { intro: sentences[0], bullets: sentences.slice(1, 9) };
    }
  }

  const intro = introParts.join(" ").trim();
  if (bullets.length === 0 && intro) {
    return { intro, bullets: [] };
  }
  return { intro, bullets: bullets.slice(0, 12) };
}

export function textToBullets(text: string): string[] {
  const { bullets, intro } = parseAiStructuredText(text);
  if (bullets.length > 0) return bullets;
  if (intro.length > 3) return [intro];
  return [];
}

export function buildFormattedAiFields(text: string): {
  text: string;
  bullets: string[];
  intro?: string;
} {
  const { intro, bullets } = parseAiStructuredText(text);
  const displayText =
    bullets.length > 0 ?
      [intro, ...bullets.map((b) => `• ${b}`)].filter(Boolean).join("\n")
    : text;
  return {
    text: displayText,
    bullets:
      bullets.length > 0 ? bullets
      : intro ? [intro]
      : [],
    ...(intro && bullets.length > 0 ? { intro } : {}),
  };
}

function processGroqResponse(raw: string, jsonObject?: boolean): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  // JSON drafts include HTML in string fields — sanitizeAiText would corrupt them.
  if (jsonObject) return trimmed.slice(0, 48000);
  return sanitizeAiText(trimmed);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function callGroqOnce(
  messages: GroqMessage[],
  maxTokens: number | undefined,
  jsonObject: boolean | undefined,
  signal: AbortSignal,
): Promise<{ text: string; model: string }> {
  const res = await fetch(`${aiConfig.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${aiConfig.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: aiConfig.model,
      messages,
      temperature: aiConfig.temperature,
      max_tokens: maxTokens ?? aiConfig.maxTokens,
      ...(jsonObject ? { response_format: { type: "json_object" } } : {}),
    }),
    signal,
  });

  if (!res.ok) {
    const errBody = await res.text().catch(() => "");
    logger.warn(`Groq API error ${res.status}: ${errBody.slice(0, 200)}`);
    if (res.status === 429) {
      throw new AppError(
        "Groq rate limit reached — wait 1–2 minutes, then try again.",
        429,
      );
    }
    throw new AppError("AI service temporarily unavailable.", 502);
  }

  const json = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  const raw = json.choices?.[0]?.message?.content || "";
  const text = processGroqResponse(raw, jsonObject);
  if (!text) throw new AppError("AI returned an empty response.", 502);
  return { text, model: aiConfig.model };
}

async function callGroq(
  messages: GroqMessage[],
  maxTokens?: number,
  jsonObject?: boolean,
): Promise<{ text: string; model: string }> {
  const retries = [0, 2500, 6000];
  let lastErr: unknown;

  for (let attempt = 0; attempt < retries.length; attempt++) {
    if (attempt > 0) await sleep(retries[attempt]);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), aiConfig.requestTimeoutMs);

    try {
      return await callGroqOnce(messages, maxTokens, jsonObject, controller.signal);
    } catch (e) {
      lastErr = e;
      if (e instanceof AppError && e.statusCode === 429 && attempt < retries.length - 1) {
        logger.warn(`Groq 429 — retry ${attempt + 1}/${retries.length - 1}`);
        continue;
      }
      if (e instanceof AppError) throw e;
      if ((e as Error).name === "AbortError") {
        throw new AppError("AI request timed out. Please try again.", 504);
      }
      logger.warn(`Groq request failed: ${(e as Error).message}`);
      throw new AppError("AI service error. Please try again.", 502);
    } finally {
      clearTimeout(timer);
    }
  }

  if (lastErr instanceof AppError) throw lastErr;
  throw new AppError("AI service error. Please try again.", 502);
}

function trimPrompt(raw: string, maxLen: number, jsonObject?: boolean): string {
  const decoded = decodeHtmlEntities(raw).replace(/\r\n/g, "\n").trim();
  if (jsonObject) return decoded.slice(0, maxLen);
  return sanitizeAiText(decoded, maxLen);
}

export async function groqChatCompletion(
  userPrompt: string,
  options?: {
    systemExtra?: string;
    maxTokens?: number;
    temperature?: number;
    jsonObject?: boolean;
    maxPromptChars?: number;
  },
): Promise<{ text: string; model: string }> {
  assertAiEnabled();
  const maxPrompt = options?.maxPromptChars ?? (options?.jsonObject ? 14000 : 6000);
  const messages: GroqMessage[] = [
    {
      role: "system",
      content:
        options?.systemExtra ?
          `${GROQ_SYSTEM_GUARDRAILS}\n\n${options.systemExtra}`
        : GROQ_SYSTEM_GUARDRAILS,
    },
    {
      role: "user",
      content: trimPrompt(userPrompt, maxPrompt, options?.jsonObject),
    },
  ];
  return callGroq(messages, options?.maxTokens, options?.jsonObject);
}

export async function groqChatWithHistory(
  messages: GroqMessage[],
  options?: { maxTokens?: number },
): Promise<{ text: string; model: string }> {
  assertAiEnabled();
  const sanitized = messages.map((m) => ({
    role: m.role,
    content:
      m.role === "system" ?
        m.content.slice(0, 12000)
      : sanitizeAiText(m.content, 2000),
  }));
  return callGroq(sanitized, options?.maxTokens);
}

export function stripModelJsonWrapper(raw: string): string {
  let s = raw.trim();
  const fenced = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) return fenced[1].trim();
  if (s.startsWith("```")) {
    return s
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```$/g, "")
      .trim();
  }
  return s;
}

export function parseJsonFromModel<T extends Record<string, unknown>>(
  raw: string,
): T | null {
  const trimmed = stripModelJsonWrapper(raw);
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  const blob = trimmed.slice(start, end + 1);
  try {
    return JSON.parse(blob) as T;
  } catch {
    try {
      const fixed = blob
        .replace(/,\s*([}\]])/g, "$1")
        .replace(/[\u201c\u201d]/g, '"')
        .replace(/[\u2018\u2019]/g, "'");
      return JSON.parse(fixed) as T;
    } catch {
      return null;
    }
  }
}
