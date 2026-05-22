import sanitizeHtml from 'sanitize-html';
import { aiConfig, assertAiEnabled } from '../../config/ai';
import AppError from '../../utils/AppError';
import logger from '../../utils/logger';

export type GroqMessage = { role: 'system' | 'user' | 'assistant'; content: string };

const SYSTEM_GUARDRAILS = `You are Rani Admin AI for The House of Rani (Indian ethnic wear e-commerce).
Rules:
- Answer only from the JSON context provided. Do not invent orders, revenue, or stock numbers.
- Be concise: use bullet lists. Mix simple Hindi and English if helpful for Indian store owners.
- Never reveal API keys, passwords, or full payment card data.
- Suggestions only — never say you executed refunds, price changes, or emails.
- If context is insufficient, say what data is missing.
- FORMAT: Put each bullet on its own line starting with "• " (newline between bullets).`;

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
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
    .replace(/\r\n/g, '\n')
    .replace(/[^\S\n]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, maxLen);
}

const BULLET_LINE = /^(?:[-–—•*]|\d+[.)])\s+(.+)$/;

function stripMarkdown(raw: string): string {
  return raw
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .trim();
}

export function parseAiStructuredText(text: string): { intro: string; bullets: string[] } {
  const normalized = stripMarkdown(sanitizeAiText(text, 12000));
  if (!normalized) return { intro: '', bullets: [] };

  const lines = normalized.split('\n').map((l) => l.trim()).filter(Boolean);
  const bullets: string[] = [];
  const introParts: string[] = [];

  for (const line of lines) {
    const m = line.match(BULLET_LINE);
    if (m) {
      bullets.push(m[1].trim());
      continue;
    }
    if (line.startsWith('•')) {
      bullets.push(line.replace(/^•\s*/, '').trim());
      continue;
    }
    if (/\s•\s/.test(line)) {
      const parts = line.split(/\s*•\s*/).map((p) => p.trim()).filter((p) => p.length > 2);
      if (parts.length > 1) {
        bullets.push(...parts);
        continue;
      }
    }
    introParts.push(line);
  }

  if (bullets.length === 0 && introParts.length === 1 && introParts[0].length > 100) {
    const chunk = introParts[0];
    const inlineBullets = chunk.split(/\s*•\s*/).map((p) => p.trim()).filter((p) => p.length > 3);
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

  const intro = introParts.join(' ').trim();
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
    bullets.length > 0
      ? [intro, ...bullets.map((b) => `• ${b}`)].filter(Boolean).join('\n')
      : text;
  return {
    text: displayText,
    bullets: bullets.length > 0 ? bullets : intro ? [intro] : [],
    ...(intro && bullets.length > 0 ? { intro } : {}),
  };
}

async function callGroq(
  messages: GroqMessage[],
  maxTokens?: number,
  jsonObject?: boolean,
): Promise<{ text: string; model: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), aiConfig.requestTimeoutMs);

  try {
    const res = await fetch(`${aiConfig.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${aiConfig.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: aiConfig.model,
        messages,
        temperature: aiConfig.temperature,
        max_tokens: maxTokens ?? aiConfig.maxTokens,
        ...(jsonObject ? { response_format: { type: 'json_object' } } : {}),
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      const errBody = await res.text().catch(() => '');
      logger.warn(`Groq API error ${res.status}: ${errBody.slice(0, 200)}`);
      if (res.status === 429) {
        throw new AppError('AI rate limit reached. Try again in a few minutes.', 429);
      }
      throw new AppError('AI service temporarily unavailable.', 502);
    }

    const json = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const raw = json.choices?.[0]?.message?.content || '';
    const text = sanitizeAiText(raw);
    if (!text) throw new AppError('AI returned an empty response.', 502);
    return { text, model: aiConfig.model };
  } catch (e) {
    if (e instanceof AppError) throw e;
    if ((e as Error).name === 'AbortError') {
      throw new AppError('AI request timed out. Please try again.', 504);
    }
    logger.warn(`Groq request failed: ${(e as Error).message}`);
    throw new AppError('AI service error. Please try again.', 502);
  } finally {
    clearTimeout(timer);
  }
}

export async function groqChatCompletion(
  userPrompt: string,
  options?: {
    systemExtra?: string;
    maxTokens?: number;
    temperature?: number;
    jsonObject?: boolean;
  },
): Promise<{ text: string; model: string }> {
  assertAiEnabled();
  const messages: GroqMessage[] = [
    {
      role: 'system',
      content: options?.systemExtra
        ? `${SYSTEM_GUARDRAILS}\n\n${options.systemExtra}`
        : SYSTEM_GUARDRAILS,
    },
    { role: 'user', content: sanitizeAiText(userPrompt, 6000) },
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
    content: m.role === 'system' ? m.content.slice(0, 12000) : sanitizeAiText(m.content, 2000),
  }));
  return callGroq(sanitized, options?.maxTokens);
}

function stripModelJsonWrapper(raw: string): string {
  let s = raw.trim();
  const fenced = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) return fenced[1].trim();
  if (s.startsWith('```')) {
    return s.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/g, '').trim();
  }
  return s;
}

export function parseJsonFromModel<T extends Record<string, unknown>>(raw: string): T | null {
  const trimmed = stripModelJsonWrapper(raw);
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  const blob = trimmed.slice(start, end + 1);
  try {
    return JSON.parse(blob) as T;
  } catch {
    try {
      const fixed = blob
        .replace(/,\s*([}\]])/g, '$1')
        .replace(/[\u201c\u201d]/g, '"')
        .replace(/[\u2018\u2019]/g, "'");
      return JSON.parse(fixed) as T;
    } catch {
      return null;
    }
  }
}
