/** Groq admin AI — keys never exposed to the client. */
export const aiConfig = {
  enabled: Boolean(process.env.GROQ_API_KEY?.trim()),
  apiKey: process.env.GROQ_API_KEY?.trim() || '',
  model: process.env.AI_MODEL?.trim() || 'llama-3.1-8b-instant',
  baseUrl: 'https://api.groq.com/openai/v1',
  dailyBriefTtlSec: Math.max(3600, parseInt(process.env.AI_DAILY_BRIEF_TTL_SEC || '86400', 10)),
  explainCacheTtlSec: Math.max(300, parseInt(process.env.AI_EXPLAIN_CACHE_TTL_SEC || '3600', 10)),
  draftCacheTtlSec: Math.max(60, parseInt(process.env.AI_DRAFT_CACHE_TTL_SEC || '1800', 10)),
  hourlyMax: Math.max(5, parseInt(process.env.AI_ADMIN_HOURLY_MAX || '30', 10)),
  maxTokens: Math.min(2048, Math.max(256, parseInt(process.env.AI_MAX_TOKENS || '1024', 10))),
  temperature: Math.min(1, Math.max(0, parseFloat(process.env.AI_TEMPERATURE || '0.35'))),
  requestTimeoutMs: Math.max(5000, parseInt(process.env.AI_REQUEST_TIMEOUT_MS || '28000', 10)),
};

/** Google Gemini — blog drafts (higher limits than Groq free tier). */
export const geminiConfig = {
  enabled: Boolean(process.env.GEMINI_API_KEY?.trim()),
  apiKey: process.env.GEMINI_API_KEY?.trim() || '',
  model: process.env.GEMINI_MODEL?.trim() || 'gemini-2.5-flash',
  baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
  maxTokens: Math.min(8192, Math.max(512, parseInt(process.env.GEMINI_MAX_TOKENS || '8192', 10))),
  temperature: Math.min(1, Math.max(0, parseFloat(process.env.GEMINI_TEMPERATURE || '0.4'))),
  requestTimeoutMs: Math.max(10000, parseInt(process.env.GEMINI_REQUEST_TIMEOUT_MS || '60000', 10)),
};

type BlogAiProvider = 'gemini' | 'groq';

function resolveBlogProvider(): BlogAiProvider {
  const raw = process.env.AI_BLOG_PROVIDER?.trim().toLowerCase();
  if (raw === 'groq') return 'groq';
  if (raw === 'gemini') return 'gemini';
  // Default: Gemini when key present, else Groq
  if (geminiConfig.enabled) return 'gemini';
  return 'groq';
}

/** Blog LLM routing — RAG + UI unchanged; only the writer model switches. */
export const blogAiConfig = {
  provider: resolveBlogProvider() as BlogAiProvider,
  get enabled(): boolean {
    return blogAiConfig.provider === 'gemini' ?
        geminiConfig.enabled
      : aiConfig.enabled;
  },
  get model(): string {
    return blogAiConfig.provider === 'gemini' ? geminiConfig.model : aiConfig.model;
  },
};

export function assertAiEnabled(): void {
  if (!aiConfig.enabled) {
    const err = new Error(
      'Admin AI is not configured. Set GROQ_API_KEY on the server.',
    ) as Error & { statusCode?: number };
    err.statusCode = 503;
    throw err;
  }
}

export function assertBlogAiEnabled(): void {
  if (blogAiConfig.enabled) return;
  const msg =
    blogAiConfig.provider === 'gemini' ?
      'Blog AI is not configured. Set GEMINI_API_KEY on the server.'
    : 'Blog AI is not configured. Set GROQ_API_KEY or GEMINI_API_KEY on the server.';
  const err = new Error(msg) as Error & { statusCode?: number };
  err.statusCode = 503;
  throw err;
}
