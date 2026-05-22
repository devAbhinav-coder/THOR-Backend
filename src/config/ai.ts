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

export function assertAiEnabled(): void {
  if (!aiConfig.enabled) {
    const err = new Error(
      'Admin AI is not configured. Set GROQ_API_KEY on the server.',
    ) as Error & { statusCode?: number };
    err.statusCode = 503;
    throw err;
  }
}
