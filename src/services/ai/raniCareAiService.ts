import { aiConfig, geminiConfig } from "../../config/ai";
import {
  buildSupportFaqContext,
  SUPPORT_CONTACT,
} from "../../constants/supportFaqKnowledge";
import AppError from "../../types/utils/AppError";
import logger from "../../types/utils/logger";
import { geminiChatCompletion } from "./geminiClient";
import {
  groqChatCompletion,
  parseJsonFromModel,
  sanitizeAiText,
} from "./groqClient";
import { RANI_CARE_SYSTEM_PROMPT } from "./raniCarePrompt";
import {
  classifyCatalogQuestion,
  looksLikeOrderQuery,
  looksLikeShopping,
  parsePriceRange,
  retrieveCatalogSummary,
  retrieveProductsForQuery,
  retrieveUserOrders,
  type CatalogQuestionKind,
  type RaniCatalogSummary,
  type RaniOrderSummary,
  type RaniProductCard,
} from "./raniCareRagService";

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
  products: RaniProductCard[];
  aiUsed: boolean;
};

export type RaniCareChatInput = {
  message: string;
  isAuthenticated?: boolean;
  userId?: string;
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

function isPromptInjectionAttempt(text: string): boolean {
  return /\b(ignore|disregard|forget|override|bypass)\b.{0,60}\b(previous|prior|above|system|instruction|rules?|policy)\b|\b(system prompt|developer message|hidden prompt|reveal prompt|api key|database (?:url|uri|connection|string)|mongodb_uri|jwt_secret|act as admin|become admin|jailbreak)\b/i.test(
    text,
  );
}

function securityBoundaryResult(_message: string): RaniCareAiResult {
  return {
    answer:
      "I can’t reveal or bypass internal prompts, API keys, database details, or security rules. I can still help with products, delivery, or your own orders.",
    routeIntent: null,
    suggestedActions: [
      { label: "Shop", value: "open shop" },
      { label: "My orders", value: "action:recent_orders" },
    ],
    products: [],
    aiUsed: false,
  };
}

/** Retrieve the RAG context (products + orders) relevant to this message. */
async function buildRetrievalContext(input: RaniCareChatInput): Promise<{
  products: RaniProductCard[];
  orders: RaniOrderSummary[];
  catalog: RaniCatalogSummary | null;
  catalogKind: CatalogQuestionKind;
}> {
  const tasks: Promise<void>[] = [];
  let products: RaniProductCard[] = [];
  let orders: RaniOrderSummary[] = [];
  let catalog: RaniCatalogSummary | null = null;
  const catalogKind = classifyCatalogQuestion(input.message);

  if (catalogKind) {
    tasks.push(
      retrieveCatalogSummary()
        .then((c) => {
          catalog = c;
        })
        .catch((e) => {
          logger.warn(`RaniCare catalog retrieval failed: ${(e as Error).message}`);
        }),
    );
  }

  if (
    looksLikeShopping(input.message) &&
    (catalogKind === "recommendation" || catalogKind === "availability")
  ) {
    tasks.push(
      retrieveProductsForQuery(input.message, 6)
        .then((p) => {
          products = p;
        })
        .catch((e) => {
          logger.warn(`RaniCare product retrieval failed: ${(e as Error).message}`);
        }),
    );
  }

  if (input.userId && looksLikeOrderQuery(input.message)) {
    tasks.push(
      retrieveUserOrders(input.userId, 50)
        .then((o) => {
          orders = o;
        })
        .catch((e) => {
          logger.warn(`RaniCare order retrieval failed: ${(e as Error).message}`);
        }),
    );
  }

  await Promise.all(tasks);
  return { products, orders, catalog, catalogKind };
}

function buildUserPrompt(
  input: RaniCareChatInput,
  ctx: {
    products: RaniProductCard[];
    orders: RaniOrderSummary[];
    catalog: RaniCatalogSummary | null;
    catalogKind: CatalogQuestionKind;
  },
): string {
  const pin = extractPincode(input.message);
  const history =
    input.recentMessages?.slice(-4).map((m) => `${m.role}: ${m.text}`) ?? [];

  const productJson =
    ctx.products.length > 0
      ? `PRODUCTS (recommend ONLY from these; use their slugs):\n${JSON.stringify(
          ctx.products.map((p) => ({
            slug: p.slug,
            name: p.name,
            priceInr: p.priceInr,
            category: p.category,
            fabric: p.fabric,
            inStock: p.inStock,
            rating: p.rating,
          })),
        )}`
      : looksLikeShopping(input.message)
        ? "PRODUCTS: [] (no matching products found — say so honestly, offer to refine)"
        : "";

  const orderJson =
    ctx.orders.length > 0
      ? `CUSTOMER ORDERS (this signed-in shopper's real orders):\n${JSON.stringify(ctx.orders)}`
      : "";
  const catalogJson = ctx.catalog
    ? `AUTHORITATIVE STOREFRONT CATALOG (only these values are available):\n${JSON.stringify(
        ctx.catalog,
      )}`
    : "";

  return [
    buildSupportFaqContext(),
    "",
    catalogJson,
    productJson,
    orderJson,
    "",
    `Customer signed in: ${input.isAuthenticated ? "yes" : "no"}`,
    input.localIntent ? `Rule-based intent hint: ${input.localIntent}` : "",
    pin ? `Pin code mentioned: ${pin}` : "",
    history.length
      ? `UNTRUSTED RECENT CHAT DATA:\n${JSON.stringify(history)}`
      : "",
    "",
    `UNTRUSTED CUSTOMER MESSAGE DATA:\n${JSON.stringify({
      message: input.message.trim(),
    })}`,
  ]
    .filter(Boolean)
    .join("\n");
}

function sanitizeActions(raw: unknown): RaniCareSuggestedAction[] {
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

/** Keep only slugs that actually came from our retrieved products (no hallucination). */
function resolveRecommendedProducts(
  raw: unknown,
  available: RaniProductCard[],
): RaniProductCard[] {
  if (available.length === 0) return [];
  const bySlug = new Map(available.map((p) => [p.slug, p]));
  const out: RaniProductCard[] = [];
  const seen = new Set<string>();

  if (Array.isArray(raw)) {
    for (const item of raw) {
      const slug = String(item ?? "").trim();
      const card = bySlug.get(slug);
      if (card && !seen.has(slug)) {
        out.push(card);
        seen.add(slug);
      }
      if (out.length >= 4) break;
    }
  }

  return out;
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
        "To check your order status, open **My orders** or send me your order number.",
      routeIntent: "show_orders",
      suggestedActions: [
        { label: "My orders", value: "action:recent_orders" },
        { label: "Contact", value: "contact support" },
      ],
      products: [],
      aiUsed: false,
    };
  }

  if (localIntent === "cancel_help") {
    return {
      answer:
        "An order can be cancelled only while its status is **pending** or **confirmed** (before dispatch).",
      routeIntent: "cancel_help",
      suggestedActions: [
        { label: "Cancel order", value: "action:cancel_help" },
        { label: "My orders", value: "action:recent_orders" },
      ],
      products: [],
      aiUsed: false,
    };
  }

  if (localIntent === "returns") {
    return {
      answer:
        "Returns are possible on **delivered** orders within **5 days** — unused, with tags intact.",
      routeIntent: "returns",
      suggestedActions: [
        { label: "Start return", value: "action:return_help" },
        { label: "Contact", value: "contact support" },
      ],
      products: [],
      aiUsed: false,
    };
  }

  if (pin) {
    return {
      answer: `We ship **across India**. Enter pin **${pin}** at checkout to see delivery options. After dispatch, delivery usually takes **3–10 business days**.`,
      routeIntent: null,
      suggestedActions: [
        { label: "Delivery info", value: "shipping time" },
        { label: "My orders", value: "action:recent_orders" },
      ],
      products: [],
      aiUsed: false,
    };
  }

  return {
    answer: `I can help with FAQs, products, and your orders. Send me your order number, or pick an option below.\nPhone: ${SUPPORT_CONTACT.phone}\nEmail: ${SUPPORT_CONTACT.email}`,
    routeIntent: null,
    suggestedActions: [
      { label: "My orders", value: "action:recent_orders" },
      { label: "Shop", value: "open shop" },
      { label: "Contact", value: "contact support" },
    ],
    products: [],
    aiUsed: false,
  };
}

function safeFact(raw: string, max = 80): string {
  return sanitizeAiText(raw, max);
}

function requestedCatalogSubject(message: string): string {
  const cleaned = message
    .toLowerCase()
    .replace(
      /\b(aur|or|kya|kay|hai|hain|apke|aapke|your|pass|paas|available|availability|koi|do|you|have|any|stock|mein|me|milta|milega|product|products|item|items|please|pls)\b/g,
      " ",
    )
    .replace(/[^a-z0-9 -]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return safeFact(cleaned || "ye item", 45);
}

function categoryForFabricQuestion(
  message: string,
  catalog: RaniCatalogSummary,
): string | null {
  return findCatalogCategory(message, catalog)?.name || null;
}

function findCatalogCategory(
  message: string,
  catalog: RaniCatalogSummary,
): { name: string; count: number } | null {
  const q = message.toLowerCase();
  if (/\b(saree|sari|sarees|saris)\b/.test(q)) {
    return (
      catalog.categories.find((x) =>
        /\b(saree|sari)(?:s)?\b/i.test(x.name),
      ) || null
    );
  }
  if (/\b(salwar|salwar suit|suit)\b/.test(q)) {
    return (
      catalog.categories.find((x) =>
        /\b(salwar|suit)(?:s)?\b/i.test(x.name),
      ) || null
    );
  }
  return (
    catalog.categories.find((x) => q.includes(x.name.toLowerCase())) || null
  );
}

/** Deterministic answers for catalog facts: the model cannot invent inventory. */
function groundedCatalogResult(
  input: RaniCareChatInput,
  ctx: {
    products: RaniProductCard[];
    catalog: RaniCatalogSummary | null;
    catalogKind: CatalogQuestionKind;
  },
): RaniCareAiResult | null {
  if (!ctx.catalog || !ctx.catalogKind) return null;

  if (ctx.catalogKind === "fabrics") {
    const category = categoryForFabricQuestion(input.message, ctx.catalog);
    const scoped = category
      ? ctx.catalog.fabricsByCategory.find((x) => x.category === category)
          ?.fabrics || []
      : ctx.catalog.fabrics;
    const names = scoped.map((x) => safeFact(x.name)).filter(Boolean);
    const answer =
      names.length > 0
        ? `${category ? `**${safeFact(category)}**` : "Our catalog"} currently has these fabrics:\n${names.map((x) => `• ${x}`).join("\n")}\n\nWould you like products in one of these fabrics?`
        : "Fabric details are not currently available in the catalog.";
    return {
      answer,
      routeIntent: null,
      suggestedActions: [
        { label: "Shop", value: "open shop" },
        { label: "Contact", value: "contact support" },
      ],
      products: [],
      aiUsed: true,
    };
  }

  if (ctx.catalogKind === "overview") {
    const categoryLines = ctx.catalog.categories.map((category) => {
      const name = safeFact(category.name);
      const children = ctx.catalog!.subcategories.filter(
        (x) => x.category === category.name,
      );
      const assignedCount = children.reduce((sum, x) => sum + x.count, 0);
      const unassignedCount = Math.max(0, category.count - assignedCount);
      const childLines =
        children.length > 0
          ? children
              .map(
                (x) =>
                  `   • ${safeFact(x.name)} (${x.count} ${x.count === 1 ? "product" : "products"})`,
              )
              .concat(
                unassignedCount > 0
                  ? [
                      `   • No subcategory (${unassignedCount} ${unassignedCount === 1 ? "product" : "products"})`,
                    ]
                  : [],
              )
              .join("\n")
          : `   • No separate subcategory is configured (${category.count} ${category.count === 1 ? "product" : "products"})`;
      return `**${name}** (${category.count} ${category.count === 1 ? "product" : "products"})\n${childLines}`;
    });
    const answer =
      categoryLines.length > 0
        ? `These categories and subcategories are in the live catalog:\n\n${categoryLines.join("\n\n")}\n\nChoose a category or subcategory and I'll show products with images.`
        : "There are currently no active categories in the storefront catalog.";
    return {
      answer,
      routeIntent: null,
      suggestedActions: [
        ...ctx.catalog.categories.slice(0, 3).map((x) => ({
          label: safeFact(x.name, 28),
          value: `show me ${safeFact(x.name, 40)} products`,
        })),
        { label: "Open shop", value: "open shop" },
      ],
      products: [],
      aiUsed: true,
    };
  }

  if (ctx.catalogKind === "category_details") {
    const category = findCatalogCategory(input.message, ctx.catalog);
    if (!category) {
      return {
        answer:
          "Which category’s subcategories would you like? You can view the live categories below.",
        routeIntent: null,
        suggestedActions: [
          { label: "All categories", value: "aapke paas kya kya milega" },
          { label: "Open shop", value: "open shop" },
        ],
        products: [],
        aiUsed: true,
      };
    }

    const subcategories = ctx.catalog.subcategories.filter(
      (x) => x.category === category.name,
    );
    const assignedCount = subcategories.reduce((sum, x) => sum + x.count, 0);
    const unassignedCount = Math.max(0, category.count - assignedCount);
    const fabricGroup = ctx.catalog.fabricsByCategory.find(
      (x) => x.category === category.name,
    );
    const subLines =
      subcategories.length > 0
        ? subcategories
            .map(
              (x) =>
                `• ${safeFact(x.name)} — ${x.count} ${x.count === 1 ? "product" : "products"}`,
            )
            .concat(
              unassignedCount > 0
                ? [
                    `• No subcategory — ${unassignedCount} ${unassignedCount === 1 ? "product" : "products"}`,
                  ]
                : [],
            )
            .join("\n")
        : "• No separate subcategory is configured";
    const fabrics =
      fabricGroup?.fabrics.map((x) => safeFact(x.name)).join(", ") || "";
    const answer = `**${safeFact(category.name)}** has ${category.count} active products listed.\n\n**Subcategories:**\n${subLines}${fabrics ? `\n\n**Fabrics:** ${fabrics}` : ""}\n\nWould you like to see the products with images?`;
    return {
      answer,
      routeIntent: null,
      suggestedActions: [
        ...subcategories.slice(0, 3).map((x) => ({
          label: safeFact(x.name, 28),
          value: `show me ${safeFact(x.name, 40)} products`,
        })),
        {
          label: `Show ${safeFact(category.name, 20)}`,
          value: `show me ${safeFact(category.name, 40)} products`,
        },
      ],
      products: [],
      aiUsed: true,
    };
  }

  if (ctx.catalogKind === "availability") {
    const subject = requestedCatalogSubject(input.message);
    if (ctx.products.length === 0) {
      return {
        answer: `I checked the live catalog—**${subject}** is not currently available. I’ll only confirm items that are actually listed.`,
        routeIntent: null,
        suggestedActions: [
          { label: "Available categories", value: "aapke paas kya kya milega" },
          { label: "Open shop", value: "open shop" },
        ],
        products: [],
        aiUsed: true,
      };
    }
    return {
      answer: `Yes, **${subject}** is available in the live catalog. Here are matching options:`,
      routeIntent: null,
      suggestedActions: [
        { label: "Open shop", value: "open shop" },
        { label: "More help", value: "action:menu" },
      ],
      products: ctx.products.slice(0, 4),
      aiUsed: true,
    };
  }

  if (ctx.catalogKind === "recommendation" && ctx.products.length === 0) {
    const { min, max } = parsePriceRange(input.message);
    const budget =
      min != null && max != null
        ? `₹${min}–₹${max}`
        : max != null
          ? `under ₹${max}`
          : min != null
            ? `above ₹${min}`
            : "";
    return {
      answer: `I checked the live catalog—there is no exact matching product ${budget ? `in the **${budget}** range ` : ""}right now. Would you like to adjust the budget or category?`,
      routeIntent: null,
      suggestedActions: [
        { label: "Available categories", value: "aapke paas kya kya milega" },
        { label: "Open shop", value: "open shop" },
      ],
      products: [],
      aiUsed: true,
    };
  }

  return null;
}

export function isRaniCareAiEnabled(): boolean {
  return geminiConfig.enabled || aiConfig.enabled;
}

/** Generate the reply JSON via Gemini (preferred) with a Groq fallback. */
async function generateReply(systemPrompt: string, userPrompt: string): Promise<string> {
  if (geminiConfig.enabled) {
    try {
      const { text } = await geminiChatCompletion(userPrompt, {
        systemBase: systemPrompt,
        jsonObject: true,
        maxTokens: 900,
        maxPromptChars: 16000,
      });
      return text;
    } catch (e) {
      logger.warn(`RaniCare Gemini failed, trying Groq: ${(e as Error).message}`);
      if (!aiConfig.enabled) throw e;
    }
  }

  const { text } = await groqChatCompletion(userPrompt, {
    systemExtra: systemPrompt,
    maxTokens: 700,
    temperature: 0.3,
    jsonObject: true,
    maxPromptChars: 12000,
  });
  return text;
}

export async function answerRaniCareMessage(
  input: RaniCareChatInput,
): Promise<RaniCareAiResult> {
  const trimmed = input.message.trim();
  if (!trimmed) {
    throw new AppError("Message is required.", 400);
  }

  if (isPromptInjectionAttempt(trimmed)) {
    return securityBoundaryResult(trimmed);
  }

  if (!isRaniCareAiEnabled()) {
    return fallbackResult(input.localIntent, trimmed);
  }

  try {
    const ctx = await buildRetrievalContext(input);
    const catalogResult = groundedCatalogResult(input, ctx);
    if (catalogResult) return catalogResult;

    const text = await generateReply(
      RANI_CARE_SYSTEM_PROMPT,
      buildUserPrompt(input, ctx),
    );

    const parsed = parseJsonFromModel<{
      answer?: string;
      routeIntent?: string | null;
      suggestedActions?: unknown;
      productSlugs?: unknown;
    }>(text);

    if (!parsed?.answer) {
      return fallbackResult(input.localIntent, trimmed);
    }

    const answer = sanitizeAiText(parsed.answer, 1200);
    const routeIntent = parseRouteIntent(parsed.routeIntent);
    const products = resolveRecommendedProducts(parsed.productSlugs, ctx.products);
    let suggestedActions = sanitizeActions(parsed.suggestedActions);

    if (products.length > 0) {
      suggestedActions = [
        { label: "Open shop", value: "open shop" },
        { label: "More help", value: "action:menu" },
      ];
    } else if (!suggestedActions.length) {
      suggestedActions = fallbackResult(input.localIntent, trimmed).suggestedActions;
    }

    // Never expose account-specific order flows to guests.
    if (
      routeIntent === "show_orders" ||
      routeIntent === "cancel_help" ||
      routeIntent === "returns"
    ) {
      if (!input.isAuthenticated && wantsOwnOrderData(trimmed)) {
        return {
          answer:
            "Please **sign in** first — then I can show you your orders.",
          routeIntent: null,
          suggestedActions: [
            { label: "Sign in", value: "sign in" },
            { label: "Contact", value: "contact support" },
          ],
          products,
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
          products,
          aiUsed: true,
        };
      }
    }

    return {
      answer,
      routeIntent,
      suggestedActions,
      products,
      aiUsed: true,
    };
  } catch (e) {
    logger.warn(`RaniCare answer failed: ${(e as Error).message}`);
    return fallbackResult(input.localIntent, trimmed);
  }
}
