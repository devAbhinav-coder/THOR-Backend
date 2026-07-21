/**
 * Natural-language storefront search parser.
 * Handles typos, fabric/color hints, and price phrases (under 5000, 3k, etc.).
 */

export const SEARCH_QUERY_MAX_LEN = 80;

export type ParsedSearchIntent = {
  rawQuery: string;
  /** Cleaned text passed to fuzzy / text search */
  textQuery: string;
  fabrics: string[];
  categories: string[];
  subcategories: string[];
  tags: string[];
  colors: string[];
  minPrice?: number;
  maxPrice?: number;
  /** Human-readable label for UI chips */
  displayLabel: string;
  /** Suggested rewrite when typos were corrected */
  didYouMean?: string;
  corrections: string[];
};

const TYPO_MAP: Record<string, string> = {
  sar: "saree",
  sarah: "saree",
  sara: "saree",
  sarahh: "saree",
  sare: "saree",
  sari: "saree",
  sarees: "saree",
  saris: "saree",
  cootton: "cotton",
  coton: "cotton",
  cotten: "cotton",
  cotn: "cotton",
  banarsi: "banarasi",
  banaras: "banarasi",
  banarasi: "banarasi",
  lehnaga: "lehenga",
  lehnga: "lehenga",
  lehenga: "lehenga",
  georget: "georgette",
  chifon: "chiffon",
  chiffon: "chiffon",
  silck: "silk",
  slik: "silk",
  slikc: "silk",
  slwar: "salwar",
  shalwar: "salwar",
  salwar: "salwar",
  slwaruit: "salwar suit",
  salwarsuit: "salwar suit",
  slawar: "salwar",
  slawarsuit: "salwar suit",
  slawarsuits: "salwar suits",
  kurti: "kurta",
  kurtis: "kurta",
  rd: "red",
  grn: "green",
  grne: "green",
  blu: "blue",
  bleu: "blue",
  org: "orange",
  ylw: "yellow",
  wht: "white",
  blk: "black",
  mrnn: "maroon",
  marron: "maroon",
};

const FABRIC_KEYWORDS = [
  "cotton",
  "silk",
  "georgette",
  "chiffon",
  "crepe",
  "linen",
  "velvet",
  "net",
  "organza",
  "banarasi",
  "khadi",
  "jute",
  "jacquard",
  "tussar",
  "chanderi",
  "bandhani",
  "ikat",
];

const COLOR_KEYWORDS = [
  "red",
  "maroon",
  "burgundy",
  "pink",
  "rose",
  "peach",
  "orange",
  "yellow",
  "gold",
  "green",
  "emerald",
  "blue",
  "navy",
  "purple",
  "violet",
  "lavender",
  "black",
  "white",
  "ivory",
  "cream",
  "beige",
  "brown",
  "grey",
  "gray",
  "silver",
  "multicolor",
];

let CATEGORY_KEYWORDS = [
  "saree",
  "lehenga",
  "kurta",
  "sarees",
  "lehengas",
  "corset",
  "corsets",
  "salwar",
  "suit",
  "suits",
  "salwar suit",
  "salwar suits",
];

let SUBCATEGORY_KEYWORDS = [
  "bridal",
  "wedding",
  "party",
  "festive",
  "casual",
  "formal",
  "handloom",
  "embroidered",
  "printed",
  "designer",
  "daily",
  "office",
  "traditional",
  "ethnic",
  "contemporary",
  "premium",
  "luxury",
];

export function updateDynamicKeywords(categories: string[], subcategories: string[]) {
  if (categories.length) {
    CATEGORY_KEYWORDS = [...new Set([...CATEGORY_KEYWORDS, ...categories.map(c => c.toLowerCase())])];
  }
  if (subcategories.length) {
    SUBCATEGORY_KEYWORDS = [...new Set([...SUBCATEGORY_KEYWORDS, ...subcategories.map(c => c.toLowerCase())])];
  }
}

export async function initSearchKeywords() {
  try {
    const mongoose = (await import('mongoose')).default;
    const Category = mongoose.model('Category');
    const SubCategory = mongoose.model('SubCategory');
    
    const categories = await Category.find({ isActive: true }).select('name').lean() as any[];
    const subcategories = await SubCategory.find({ isActive: true }).select('name').lean() as any[];
    
    updateDynamicKeywords(
      categories.map(c => c.name),
      subcategories.map(s => s.name)
    );
  } catch (err) {
    console.error('Failed to init search keywords', err);
  }
}

const TAG_KEYWORDS = [
  "festive",
  "bridal",
  "wedding",
  "party",
  "casual",
  "formal",
  "handloom",
  "embroidered",
  "bestseller",
  "premium",
  "luxury",
  "designer",
  "traditional",
  "ethnic",
  "trending",
  "exclusive",
  "limited",
];

const PHRASE_HINTS = [
  "party wear",
  "daily wear",
  "office wear",
  "festive wear",
  "bridal wear",
  "silk saree",
  "cotton saree",
  "banarasi saree",
  "red saree",
  "bridal lehenga",
  "wedding lehenga",
  "salwar suit",
  "salwar suits",
  "new arrival",
];

const PRICE_UNDER_RE =
  /\b(?:under|below|upto|up\s*to|less\s*than|max|ke\s*neeche|se\s*kam|tak|underneath|within)\b/gi;
const PRICE_ABOVE_RE =
  /\b(?:above|over|from|more\s*than|greater\s*than|min|at\s*least|ke\s*upar|se\s*zyada|starting)\b/gi;
const PRICE_AMOUNT_RE =
  /(?:₹|rs\.?|inr\s*)?(\d+(?:\.\d+)?)\s*(k|thousand)?|\b(\d{1,2})\s*k\b/gi;

function normalizeRaw(raw: unknown): string {
  if (typeof raw !== "string") return "";
  return raw
    .normalize("NFC")
    .trim()
    .replace(/[\x00-\x1f]/g, "")
    .replace(/\s+/g, " ")
    .slice(0, SEARCH_QUERY_MAX_LEN);
}

function parseAmount(match: RegExpExecArray): number | undefined {
  if (match[3]) {
    const n = Number.parseInt(match[3], 10);
    return Number.isFinite(n) ? n * 1000 : undefined;
  }
  const base = Number.parseFloat(match[1]);
  if (!Number.isFinite(base)) return undefined;
  const mult =
    match[2] && /^k|thousand$/i.test(match[2]) ? 1000 : 1;
  return Math.round(base * mult);
}

function titleCase(word: string): string {
  if (!word) return word;
  return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
}

/** Map parsed category keywords to storefront parent category names. */
const CATEGORY_INTENT_TO_DB: Record<string, string> = {
  saree: "Sarees",
  sarees: "Sarees",
  sari: "Sarees",
  saris: "Sarees",
  lehenga: "Lehengas",
  lehengas: "Lehengas",
  "lehenga choli": "Lehengas",
  kurta: "Salwar Suits",
  kurti: "Salwar Suits",
  salwar: "Salwar Suits",
  suit: "Salwar Suits",
  suits: "Salwar Suits",
  "salwar suit": "Salwar Suits",
  "salwar suits": "Salwar Suits",
  churidar: "Salwar Suits",
  corset: "Corsets",
  corsets: "Corsets",
};

export function normalizeIntentCategory(keyword: string): string {
  const trimmed = keyword.trim();
  if (!trimmed) return trimmed;
  const mapped = CATEGORY_INTENT_TO_DB[trimmed.toLowerCase()];
  return mapped ?? titleCase(trimmed);
}

/** Text tokens left after removing parsed fabric/category/color hints. */
export function buildResidualTextQuery(intent: ParsedSearchIntent): string {
  const source = (intent.textQuery || intent.rawQuery).trim();
  if (!source) return "";

  const semanticWords = new Set<string>();
  for (const fabric of intent.fabrics ?? []) {
    semanticWords.add(fabric.toLowerCase());
  }
  for (const category of intent.categories ?? []) {
    semanticWords.add(category.toLowerCase());
    semanticWords.add(normalizeIntentCategory(category).toLowerCase());
  }
  for (const subcategory of intent.subcategories ?? []) {
    for (const word of subcategory.toLowerCase().split(/\s+/)) {
      if (word) semanticWords.add(word);
    }
  }
  for (const color of intent.colors ?? []) {
    semanticWords.add(color.toLowerCase());
  }
  for (const tag of intent.tags ?? []) {
    for (const word of tag.toLowerCase().split(/\s+/)) {
      if (word) semanticWords.add(word);
    }
  }

  return source
    .split(/\s+/)
    .filter((token) => !semanticWords.has(token.toLowerCase()))
    .join(" ")
    .trim();
}

function normalizePricePhrases(text: string): string {
  return text
    .replace(/\bless\s+than\b/gi, " under ")
    .replace(/\bgreater\s+than\b/gi, " above ")
    .replace(/\bmore\s+than\b/gi, " above ")
    .replace(/\bup\s+to\b/gi, " under ")
    .replace(/\bke\s+neeche\b/gi, " under ")
    .replace(/\bse\s+kam\b/gi, " under ")
    .replace(/\bse\s+zyada\b/gi, " above ")
    .replace(/\bke\s+upar\b/gi, " above ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractPrice(text: string): {
  remainder: string;
  minPrice?: number;
  maxPrice?: number;
} {
  let remainder = normalizePricePhrases(text);
  let minPrice: number | undefined;
  let maxPrice: number | undefined;

  const segments = remainder.split(/\s+/);
  const kept: string[] = [];

  for (let i = 0; i < segments.length; i++) {
    const token = segments[i];
    const lower = token.toLowerCase();
    const next = segments[i + 1]?.toLowerCase() ?? "";
    const prev = segments[i - 1]?.toLowerCase() ?? "";

    const underCtx =
      PRICE_UNDER_RE.test(prev) ||
      ["under", "below", "upto", "max", "tak"].includes(prev);
    const aboveCtx =
      PRICE_ABOVE_RE.test(prev) ||
      ["above", "over", "from", "min"].includes(prev);

    PRICE_UNDER_RE.lastIndex = 0;
    PRICE_ABOVE_RE.lastIndex = 0;

    const amountMatch = token.match(/^(\d+(?:\.\d+)?)(k|K)?$/) ??
      token.match(/^₹?(\d+(?:\.\d+)?)(k|K)?$/);
    if (amountMatch) {
      let amount = Number.parseFloat(amountMatch[1]);
      if (amountMatch[2]) amount *= 1000;
      amount = Math.round(amount);
      if (underCtx || next === "tak" || lower.endsWith("k")) {
        maxPrice = amount;
        if (lower.endsWith("k") && !amountMatch[2]) {
          maxPrice = Math.round(Number.parseFloat(lower.replace(/k$/i, "")) * 1000);
        }
        if (["under", "below", "upto", "max", "tak"].includes(prev)) {
          kept.pop();
        }
        continue;
      }
      if (aboveCtx) {
        minPrice = amount;
        if (["above", "over", "from", "min"].includes(prev)) kept.pop();
        continue;
      }
    }

    if (PRICE_UNDER_RE.test(token)) {
      PRICE_UNDER_RE.lastIndex = 0;
      const nextToken = segments[i + 1];
      const m = nextToken?.match(/^(\d+(?:\.\d+)?)(k|K)?$/) ??
        nextToken?.match(/^₹?(\d+(?:\.\d+)?)(k|K)?$/);
      if (m) {
        let amount = Number.parseFloat(m[1]);
        if (m[2]) amount *= 1000;
        maxPrice = Math.round(amount);
        i += 1;
        continue;
      }
      continue;
    }

    if (PRICE_ABOVE_RE.test(token)) {
      PRICE_ABOVE_RE.lastIndex = 0;
      const nextToken = segments[i + 1];
      const m = nextToken?.match(/^(\d+(?:\.\d+)?)(k|K)?$/);
      if (m) {
        let amount = Number.parseFloat(m[1]);
        if (m[2]) amount *= 1000;
        minPrice = Math.round(amount);
        i += 1;
        continue;
      }
      continue;
    }

    if (
      [
        "under",
        "below",
        "upto",
        "max",
        "tak",
        "above",
        "over",
        "from",
        "min",
        "less",
        "than",
        "greater",
        "more",
      ].includes(lower)
    ) {
      continue;
    }

    kept.push(token);
  }

  remainder = kept.join(" ").trim();

  // Fallback: "5000" alone at end often means budget
  const trailing = remainder.match(/\b(\d{3,5})\s*$/);
  if (trailing && maxPrice === undefined) {
    maxPrice = Number.parseInt(trailing[1], 10);
    remainder = remainder.slice(0, trailing.index).trim();
  }

  return { remainder, minPrice, maxPrice };
}

function correctToken(token: string): { word: string; corrected: boolean } {
  const lower = token.toLowerCase();
  if (TYPO_MAP[lower]) {
    return { word: TYPO_MAP[lower], corrected: TYPO_MAP[lower] !== lower };
  }
  return { word: lower, corrected: false };
}

function pickKeywords(words: string[], dictionary: string[]): string[] {
  const found: string[] = [];
  for (const word of words) {
    const match = dictionary.find(
      (k) => k === word || levenshtein(word, k) <= (word.length <= 4 ? 1 : 2),
    );
    if (match && !found.includes(match)) found.push(match);
  }
  return found;
}

function isFuzzyMatchedToken(
  word: string,
  picks: string[],
  dictionary: string[],
): boolean {
  if (!picks.length) return false;
  return picks.some((pick) => {
    if (word === pick) return true;
    const dictMatch = dictionary.find(
      (k) => k === word || levenshtein(word, k) <= (word.length <= 4 ? 1 : 2),
    );
    return dictMatch === pick;
  });
}

function dedupeStrings(items: string[]): string[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = item.trim().toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function pickPhrases(text: string, phrases: string[]): string[] {
  const lower = text.toLowerCase();
  const found: string[] = [];
  const sorted = [...phrases].sort((a, b) => b.length - a.length);
  for (const phrase of sorted) {
    if (!lower.includes(phrase)) continue;
    if (found.some((f) => f.includes(phrase) || phrase.includes(f))) continue;
    found.push(phrase);
  }
  return found;
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  const matrix: number[][] = Array.from({ length: b.length + 1 }, (_, j) =>
    Array.from({ length: a.length + 1 }, (_, i) => (j === 0 ? i : i === 0 ? j : 0)),
  );
  for (let j = 1; j <= b.length; j++) {
    for (let i = 1; i <= a.length; i++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[j][i] = Math.min(
        matrix[j][i - 1] + 1,
        matrix[j - 1][i] + 1,
        matrix[j - 1][i - 1] + cost,
      );
    }
  }
  return matrix[b.length][a.length];
}

export function parseSearchQueryIntent(raw: unknown): ParsedSearchIntent {
  const rawQuery = normalizeRaw(raw);
  if (!rawQuery) {
    return {
      rawQuery: "",
      textQuery: "",
      fabrics: [],
      categories: [],
      subcategories: [],
      tags: [],
      colors: [],
      displayLabel: "",
      corrections: [],
    };
  }

  const { remainder, minPrice, maxPrice } = extractPrice(rawQuery);
  const corrections: string[] = [];
  const tokens = remainder.split(/\s+/).filter(Boolean);
  const correctedWords: string[] = [];

  for (const token of tokens) {
    const { word, corrected } = correctToken(token.replace(/[^\p{L}\p{N}]/gu, ""));
    if (!word) continue;
    correctedWords.push(word);
    if (corrected) corrections.push(`${token} → ${word}`);
  }

  const fabrics = pickKeywords(correctedWords, FABRIC_KEYWORDS);
  const colors = pickKeywords(correctedWords, COLOR_KEYWORDS);
  const categoryPhrases = pickPhrases(rawQuery, [
    "salwar suit",
    "salwar suits",
    "lehenga choli",
    "red saree",
  ]);
  const categories = dedupeStrings([
    ...categoryPhrases,
    ...pickKeywords(correctedWords, CATEGORY_KEYWORDS),
  ]);
  const subcategories = dedupeStrings([
    ...pickKeywords(correctedWords, SUBCATEGORY_KEYWORDS),
    ...pickPhrases(rawQuery, PHRASE_HINTS),
  ]);
  const tags = dedupeStrings([
    ...pickKeywords(correctedWords, TAG_KEYWORDS),
    ...pickPhrases(rawQuery, TAG_KEYWORDS),
  ]);

  const semanticTokens: string[] = [];
  for (const word of correctedWords) {
    if (isFuzzyMatchedToken(word, fabrics, FABRIC_KEYWORDS)) {
      const pick = fabrics.find((pick) =>
        isFuzzyMatchedToken(word, [pick], FABRIC_KEYWORDS),
      );
      if (pick && !semanticTokens.includes(pick)) semanticTokens.push(pick);
      continue;
    }
    if (isFuzzyMatchedToken(word, colors, COLOR_KEYWORDS)) {
      const pick = colors.find((pick) =>
        isFuzzyMatchedToken(word, [pick], COLOR_KEYWORDS),
      );
      if (pick && !semanticTokens.includes(pick)) semanticTokens.push(pick);
      continue;
    }
    if (isFuzzyMatchedToken(word, categories, CATEGORY_KEYWORDS)) {
      const pick = categories.find((pick) =>
        isFuzzyMatchedToken(word, [pick], CATEGORY_KEYWORDS),
      );
      if (pick && !semanticTokens.includes(pick)) semanticTokens.push(pick);
      continue;
    }
    if (isFuzzyMatchedToken(word, subcategories, SUBCATEGORY_KEYWORDS)) {
      continue;
    }
    if (isFuzzyMatchedToken(word, tags, TAG_KEYWORDS)) {
      continue;
    }
    semanticTokens.push(word);
  }
  const phraseTokens = dedupeStrings([
    ...categoryPhrases,
    ...subcategories,
    ...tags.filter((t) => !subcategories.includes(t)),
  ]);
  const phraseWords = new Set(
    phraseTokens.join(" ").toLowerCase().split(/\s+/).filter(Boolean),
  );
  const filteredSemantic = semanticTokens.filter(
    (word) => !phraseWords.has(word.toLowerCase()),
  );
  const textQuery = dedupeStrings([...phraseTokens, ...filteredSemantic])
    .join(" ")
    .trim();

  const displayParts: string[] = [];
  if (textQuery) {
    displayParts.push(
      textQuery
        .split(/\s+/)
        .map(titleCase)
        .join(" "),
    );
  }

  if (maxPrice !== undefined) displayParts.push(`Under ₹${maxPrice.toLocaleString("en-IN")}`);
  if (minPrice !== undefined) displayParts.push(`Above ₹${minPrice.toLocaleString("en-IN")}`);

  const displayLabel = displayParts.join(" · ") || rawQuery;
  const normalizedRaw = rawQuery.trim().toLowerCase();
  const normalizedText = textQuery.trim().toLowerCase();
  const didYouMean =
    corrections.length > 0 ? textQuery || displayLabel
    : normalizedText && normalizedText !== normalizedRaw ? textQuery
    : undefined;

  return {
    rawQuery,
    textQuery,
    fabrics,
    categories,
    subcategories,
    tags,
    colors,
    minPrice,
    maxPrice,
    displayLabel,
    didYouMean,
    corrections,
  };
}

/** Rebuild a navigable search string from parsed intent (keeps price + color). */
export function formatIntentAsQuery(intent: ParsedSearchIntent): string {
  if (!intent.rawQuery && !intent.textQuery) return "";

  let query = intent.textQuery.trim() || intent.rawQuery.trim();
  if (
    intent.maxPrice !== undefined &&
    !/\b(under|below|less|upto|max)\b/i.test(query)
  ) {
    query += ` under ${intent.maxPrice}`;
  } else if (
    intent.minPrice !== undefined &&
    !/\b(above|over|greater|more|from|min)\b/i.test(query)
  ) {
    query += ` above ${intent.minPrice}`;
  }
  return query.trim().slice(0, SEARCH_QUERY_MAX_LEN);
}

/** Merge parsed intent with explicit API filter params (explicit wins). */
export function mergeSearchIntentWithFilters(
  intent: ParsedSearchIntent,
  filters: {
    colors?: string[];
    categories?: string[];
    subcategories?: string[];
    minPrice?: number;
    maxPrice?: number;
  },
): {
  query: string;
  residualQuery: string;
  colors: string[];
  categories: string[];
  minPrice?: number;
  maxPrice?: number;
  subcategories: string[];
  tags: string[];
} {
  const colorSet = new Set<string>();
  for (const color of intent.colors ?? []) {
    colorSet.add(titleCase(color));
  }
  for (const color of filters.colors ?? []) {
    colorSet.add(titleCase(color));
  }

  const categorySet = new Set<string>();
  for (const category of intent.categories ?? []) {
    categorySet.add(normalizeIntentCategory(category));
  }
  for (const category of filters.categories ?? []) {
    categorySet.add(normalizeIntentCategory(category));
  }

  const subcategorySet = new Set(
    [...(intent.subcategories || []), ...(filters.subcategories || [])]
  );

  return {
    query: intent.textQuery || intent.rawQuery,
    residualQuery: buildResidualTextQuery(intent),
    colors: [...colorSet],
    categories: [...categorySet],
    minPrice: filters.minPrice ?? intent.minPrice,
    maxPrice: filters.maxPrice ?? intent.maxPrice,
    subcategories: Array.from(subcategorySet),
    tags: intent.tags,
  };
}
