import { aiConfig } from "../../config/ai";
import {
  buildSupportFaqContext,
  SUPPORT_CONTACT,
} from "../../constants/supportFaqKnowledge";
import AppError from "../../types/utils/AppError";
import {
  groqChatCompletion,
  parseJsonFromModel,
  sanitizeAiText,
} from "./groqClient";
import { RANI_CARE_SYSTEM_PROMPT } from "./raniCarePrompt";

export type RaniCareRouteIntent =
  | "show_orders"
  | "cancel_help"
  | "returns"
  | "contact"
  | null;

export type RaniCareSuggestedAction = {
  label: string;
  value: string;
};

export type RaniCareAiResult = {
  answer: string;
  routeIntent: RaniCareRouteIntent;
  suggestedActions: RaniCareSuggestedAction[];
  aiUsed: boolean;
};

export type RaniCareChatInput = {
  message: string;
  isAuthenticated?: boolean;
  localIntent?: string;
  recentMessages?: Array<{ role: "user" | "bot"; text: string }>;
};

const ALLOWED_ACTION_VALUES = new Set([
  "action:recent_orders",
  "action:cancel_help",
  "action:return_help",
  "action:menu",
  "shipping time",
  "contact support",
  "open shop",
  "open cart",
  "shipping policy",
  "privacy policy",
  "terms policy",
  "sign in",
]);

const ROUTE_INTENTS = new Set([
  "show_orders",
  "cancel_help",
  "returns",
  "contact",
]);

function extractPincode(text: string): string | null {
  const m = text.match(/\b(\d{6})\b/);
  return m?.[1] ?? null;
}

function wantsOwnOrderData(text: string): boolean {
  const q = text.toLowerCase();
  return /\b(my order|mera order|mere order|meri order|order number|track|awb|parcel kab|order status|kahan hai)\b/.test(
    q,
  );
}

function buildUserPrompt(input: RaniCareChatInput): string {
  const pin = extractPincode(input.message);
  const history =
    input.recentMessages?.slice(-4).map((m) => `${m.role}: ${m.text}`) ?? [];

  return [
    buildSupportFaqContext(),
    "",
    `Customer signed in: ${input.isAuthenticated ? "yes" : "no"}`,
    input.localIntent ? `Rule-based intent hint: ${input.localIntent}` : "",
    pin ? `Pin code mentioned: ${pin}` : "",
    history.length ? `Recent chat:\n${history.join("\n")}` : "",
    "",
    `Customer message: ${input.message.trim()}`,
  ]
    .filter(Boolean)
    .join("\n");
}

function sanitizeActions(
  raw: unknown,
): RaniCareSuggestedAction[] {
  if (!Array.isArray(raw)) return [];
  const out: RaniCareSuggestedAction[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const label = sanitizeAiText(String((item as { label?: string }).label ?? ""), 40);
    const value = String((item as { value?: string }).value ?? "").trim();
    if (!label || !ALLOWED_ACTION_VALUES.has(value)) continue;
    out.push({ label, value });
    if (out.length >= 4) break;
  }
  return out;
}

function parseRouteIntent(raw: unknown): RaniCareRouteIntent {
  if (raw === null || raw === undefined || raw === "null") return null;
  const s = String(raw).trim();
  return ROUTE_INTENTS.has(s) ? (s as RaniCareRouteIntent) : null;
}

function fallbackResult(
  localIntent?: string,
  message?: string,
): RaniCareAiResult {
  const q = (message ?? "").toLowerCase();
  const pin = extractPincode(q);

  if (localIntent === "show_orders" || /\b(kahan|kab|track|status)\b/.test(q)) {
    return {
      answer:
        "Apne order ka status dekhne ke liye **My orders** kholo, ya order number bhejo.",
      routeIntent: "show_orders",
      suggestedActions: [
        { label: "My orders", value: "action:recent_orders" },
        { label: "Contact", value: "contact support" },
      ],
      aiUsed: false,
    };
  }

  if (localIntent === "cancel_help") {
    return {
      answer:
        "Order cancel tabhi ho sakta hai jab status **pending** ya **confirmed** ho (dispatch se pehle).",
      routeIntent: "cancel_help",
      suggestedActions: [
        { label: "Cancel order", value: "action:cancel_help" },
        { label: "My orders", value: "action:recent_orders" },
      ],
      aiUsed: false,
    };
  }

  if (localIntent === "returns") {
    return {
      answer:
        "Return **delivered** orders par **7 din** ke andar possible hai — unused, tags ke saath.",
      routeIntent: "returns",
      suggestedActions: [
        { label: "Start return", value: "action:return_help" },
        { label: "Contact", value: "contact support" },
      ],
      aiUsed: false,
    };
  }

  if (pin) {
    return {
      answer: `Hum **poore India** mein ship karte hain. Pin **${pin}** checkout par daal kar delivery options dekh sakte ho. Dispatch ke baad aksar **3–10 business days** lagte hain.`,
      routeIntent: null,
      suggestedActions: [
        { label: "Delivery info", value: "shipping time" },
        { label: "My orders", value: "action:recent_orders" },
      ],
      aiUsed: false,
    };
  }

  return {
    answer: `Main FAQ aur policy ke hisaab se madad kar sakti hoon. Order number ke saath likho, ya neeche option chuno.\nPhone: ${SUPPORT_CONTACT.phone}\nEmail: ${SUPPORT_CONTACT.email}`,
    routeIntent: null,
    suggestedActions: [
      { label: "My orders", value: "action:recent_orders" },
      { label: "Delivery", value: "shipping time" },
      { label: "Contact", value: "contact support" },
    ],
    aiUsed: false,
  };
}

export function isRaniCareAiEnabled(): boolean {
  return aiConfig.enabled;
}

export async function answerRaniCareMessage(
  input: RaniCareChatInput,
): Promise<RaniCareAiResult> {
  const trimmed = input.message.trim();
  if (!trimmed) {
    throw new AppError("Message is required.", 400);
  }

  if (!aiConfig.enabled) {
    return fallbackResult(input.localIntent, trimmed);
  }

  try {
    const { text } = await groqChatCompletion(buildUserPrompt(input), {
      systemExtra: RANI_CARE_SYSTEM_PROMPT,
      maxTokens: 512,
      temperature: 0.25,
      jsonObject: true,
      maxPromptChars: 8000,
    });

    const parsed = parseJsonFromModel<{
      answer?: string;
      routeIntent?: string | null;
      suggestedActions?: unknown;
    }>(text);

    if (!parsed?.answer) {
      return fallbackResult(input.localIntent, trimmed);
    }

    const answer = sanitizeAiText(parsed.answer, 1200);
    const routeIntent = parseRouteIntent(parsed.routeIntent);
    let suggestedActions = sanitizeActions(parsed.suggestedActions);

    if (!suggestedActions.length) {
      suggestedActions = fallbackResult(input.localIntent, trimmed).suggestedActions;
    }

    if (
      routeIntent === "show_orders" ||
      routeIntent === "cancel_help" ||
      routeIntent === "returns"
    ) {
      if (!input.isAuthenticated && wantsOwnOrderData(trimmed)) {
        return {
          answer:
            "Iske liye pehle **sign in** karo — phir apne orders dikhenge.",
          routeIntent: null,
          suggestedActions: [
            { label: "Sign in", value: "sign in" },
            { label: "Contact", value: "contact support" },
          ],
          aiUsed: true,
        };
      }
      if (
        !input.isAuthenticated &&
        routeIntent === "show_orders" &&
        !wantsOwnOrderData(trimmed)
      ) {
        return {
          answer,
          routeIntent: null,
          suggestedActions,
          aiUsed: true,
        };
      }
    }

    return {
      answer,
      routeIntent,
      suggestedActions,
      aiUsed: true,
    };
  } catch {
    return fallbackResult(input.localIntent, trimmed);
  }
}
