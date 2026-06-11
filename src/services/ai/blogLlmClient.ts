import { assertBlogAiEnabled, blogAiConfig } from "../../config/ai";
import { groqChatCompletion } from "./groqClient";
import { geminiChatCompletion } from "./geminiClient";

export type BlogLlmOptions = {
  systemExtra?: string;
  maxTokens?: number;
  jsonObject?: boolean;
  maxPromptChars?: number;
};

export type BlogLlmResult = { text: string; model: string; truncated?: boolean };

/** Blog drafts — Gemini by default when GEMINI_API_KEY is set; Groq fallback. */
export async function blogChatCompletion(
  userPrompt: string,
  options?: BlogLlmOptions,
): Promise<BlogLlmResult> {
  assertBlogAiEnabled();

  if (blogAiConfig.provider === "gemini") {
    return geminiChatCompletion(userPrompt, options);
  }
  const r = await groqChatCompletion(userPrompt, options);
  return { text: r.text, model: r.model };
}
