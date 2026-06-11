import { geminiConfig } from "../../config/ai";
import AppError from "../../types/utils/AppError";
import logger from "../../types/utils/logger";
import { BLOG_SYSTEM_BASE } from "./aiPromptConstants";
import { sanitizeAiText } from "./groqClient";

function trimPrompt(raw: string, maxLen: number, jsonObject?: boolean): string {
  const decoded = raw.replace(/\r\n/g, "\n").trim();
  if (jsonObject) return decoded.slice(0, maxLen);
  return sanitizeAiText(decoded, maxLen);
}

function processGeminiResponse(raw: string, jsonObject?: boolean): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  if (jsonObject) return trimmed.slice(0, 48000);
  return sanitizeAiText(trimmed);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function callGeminiOnce(
  systemText: string,
  userText: string,
  maxTokens: number | undefined,
  jsonObject: boolean | undefined,
  signal: AbortSignal,
): Promise<{ text: string; model: string; truncated: boolean }> {
  const model = geminiConfig.model;
  const url = `${geminiConfig.baseUrl}/models/${model}:generateContent?key=${encodeURIComponent(geminiConfig.apiKey)}`;

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: systemText }] },
      contents: [{ role: "user", parts: [{ text: userText }] }],
      generationConfig: {
        temperature: geminiConfig.temperature,
        maxOutputTokens: maxTokens ?? geminiConfig.maxTokens,
        ...(jsonObject ? { responseMimeType: "application/json" } : {}),
      },
      safetySettings: [
        { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_ONLY_HIGH" },
        { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_ONLY_HIGH" },
        { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_ONLY_HIGH" },
        { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_ONLY_HIGH" },
      ],
    }),
    signal,
  });

  if (!res.ok) {
    const errBody = await res.text().catch(() => "");
    logger.warn(`Gemini API error ${res.status}: ${errBody.slice(0, 300)}`);
    if (res.status === 429) {
      throw new AppError(
        "Gemini rate limit reached — wait 30–60 seconds, then click Regenerate.",
        429,
      );
    }
    if (res.status === 503) {
      throw new AppError("Gemini is under high demand — wait 30 seconds and retry.", 503);
    }
    throw new AppError("Gemini AI temporarily unavailable.", 502);
  }

  const json = (await res.json()) as {
    candidates?: Array<{
      content?: { parts?: Array<{ text?: string }> };
      finishReason?: string;
    }>;
    promptFeedback?: { blockReason?: string };
  };

  if (json.promptFeedback?.blockReason) {
    logger.warn(`Gemini blocked prompt: ${json.promptFeedback.blockReason}`);
    throw new AppError("Gemini blocked this content — try a slightly different topic.", 502);
  }

  const candidate = json.candidates?.[0];
  const raw = candidate?.content?.parts?.map((p) => p.text || "").join("") || "";
  const truncated = candidate?.finishReason === "MAX_TOKENS";

  if (truncated) {
    logger.warn("Gemini response truncated (MAX_TOKENS)");
  }

  const text = processGeminiResponse(raw, jsonObject);
  if (!text) throw new AppError("Gemini returned an empty response.", 502);
  return { text, model, truncated };
}

async function callGemini(
  systemText: string,
  userText: string,
  maxTokens?: number,
  jsonObject?: boolean,
): Promise<{ text: string; model: string; truncated: boolean }> {
  const retries = [0, 3000, 8000];
  let lastErr: unknown;

  for (let attempt = 0; attempt < retries.length; attempt++) {
    if (attempt > 0) await sleep(retries[attempt]);
    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(),
      geminiConfig.requestTimeoutMs,
    );

    try {
      return await callGeminiOnce(
        systemText,
        userText,
        maxTokens,
        jsonObject,
        controller.signal,
      );
    } catch (e) {
      lastErr = e;
      if (
        e instanceof AppError &&
        (e.statusCode === 429 || e.statusCode === 503) &&
        attempt < retries.length - 1
      ) {
        logger.warn(`Gemini ${e.statusCode} — retry ${attempt + 1}/${retries.length - 1}`);
        continue;
      }
      if (e instanceof AppError) throw e;
      if ((e as Error).name === "AbortError") {
        throw new AppError("Gemini request timed out. Please try again.", 504);
      }
      logger.warn(`Gemini request failed: ${(e as Error).message}`);
      throw new AppError("Gemini AI error. Please try again.", 502);
    } finally {
      clearTimeout(timer);
    }
  }

  if (lastErr instanceof AppError) throw lastErr;
  throw new AppError("Gemini AI error. Please try again.", 502);
}

export async function geminiChatCompletion(
  userPrompt: string,
  options?: {
    systemExtra?: string;
    maxTokens?: number;
    jsonObject?: boolean;
    maxPromptChars?: number;
  },
): Promise<{ text: string; model: string; truncated?: boolean }> {
  if (!geminiConfig.enabled) {
    throw new AppError(
      "Gemini not configured. Set GEMINI_API_KEY on the server.",
      503,
    );
  }

  const maxPrompt = options?.maxPromptChars ?? (options?.jsonObject ? 28000 : 8000);
  const systemText =
    options?.systemExtra ?
      `${BLOG_SYSTEM_BASE}\n\n${options.systemExtra}`
    : BLOG_SYSTEM_BASE;
  const userText = trimPrompt(userPrompt, maxPrompt, options?.jsonObject);

  return callGemini(systemText, userText, options?.maxTokens, options?.jsonObject);
}
