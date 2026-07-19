/**
 * Rani Care RAG retrieval — pulls real store data from MongoDB so the customer
 * assistant can answer naturally (products, prices, the shopper's own orders).
 * No external embedding API: product re-ranking uses the local feature-hash
 * vectors already stored on Product.contentEmbedding.
 */
import Order from "../../models/Order";
import Product from "../../models/Product";
import { OFFLINE_MANUAL_PRODUCT_TAG } from "../../constants/offlineOrder";
import { cosineSimilarity, embedText } from "./textEmbedding";

export type RaniProductCard = {
  name: string;
  slug: string;
  priceInr: number;
  comparePriceInr?: number;
  image?: string;
  category?: string;
  fabric?: string;
  inStock: boolean;
  rating?: number;
};

export type RaniOrderSummary = {
  orderNumber: string;
  status: string;
  paymentStatus?: string;
  paymentMethod?: string;
  totalInr: number;
  placedOn: string;
  items: string[];
  tracking?: string | null;
  carrier?: string | null;
  returnStatus?: string;
  deliveredOn?: string | null;
};

export type RaniCatalogSummary = {
  totalProducts: number;
  categories: Array<{ name: string; count: number }>;
  subcategories: Array<{ name: string; category: string; count: number }>;
  fabrics: Array<{ name: string; count: number }>;
  fabricsByCategory: Array<{
    category: string;
    fabrics: Array<{ name: string; count: number }>;
  }>;
  priceRange: { min: number | null; max: number | null };
};

const CARD_SELECT = "name slug price comparePrice category fabric images ratings totalStock";
const STOREFRONT_FILTER = {
  isActive: true,
  category: { $ne: "Gifting" },
  tags: { $nin: [OFFLINE_MANUAL_PRODUCT_TAG] },
} as const;

const PRODUCT_TYPE_ALIASES: Array<{ re: RegExp; pattern: string; label: string }> = [
  { re: /\b(saree|sari|sarees|saris)\b/i, pattern: "saree|sari", label: "saree" },
  { re: /\b(salwar suit|salwar|suits?)\b/i, pattern: "salwar|suit", label: "salwar suit" },
  { re: /\b(kurta|kurti|kurtas|kurtis)\b/i, pattern: "kurta|kurti", label: "kurta/kurti" },
  { re: /\b(lehenga|lehnga|lehengas)\b/i, pattern: "lehenga|lehnga", label: "lehenga" },
  { re: /\b(dupatta|dupattas)\b/i, pattern: "dupatta", label: "dupatta" },
  { re: /\b(blouse|blouses)\b/i, pattern: "blouse", label: "blouse" },
  { re: /\b(gown|gowns)\b/i, pattern: "gown", label: "gown" },
  { re: /\b(dress|dresses)\b/i, pattern: "dress", label: "dress" },
  { re: /\b(gift|gifting|hamper|hampers)\b/i, pattern: "gift|hamper", label: "gift" },
];

export type CatalogQuestionKind =
  | "fabrics"
  | "overview"
  | "category_details"
  | "availability"
  | "recommendation"
  | null;

export function classifyCatalogQuestion(message: string): CatalogQuestionKind {
  const q = message.toLowerCase();
  // Substring match tolerates typos: fabrci, fabrc, febric, kapde…
  if (/(fabri|fabrc|febri|kapd|material)/.test(q)) return "fabrics";
  if (
    /\b(best|recommend|suggest|dikha|dikhao|under|below|above|between|budget|sasta|cheap|rs\.?|rupees|₹)\b/.test(
      q,
    )
  ) {
    return "recommendation";
  }
  if (
    /\b(subcategor|sub categor|subcategory|subcategories)\w*\b/.test(q) ||
    /\b(saree|sari|salwar suit|salwar)\b.{0,25}\b(kya kya|kay kay|kaun kaun|which|list|types?|variety|varieties)\b/.test(
      q,
    ) ||
    /\b(saree|sari|salwar suit|salwar)\b.{0,12}\b(me|mein|category)\b.{0,12}\bkya\b/.test(
      q,
    ) ||
    /\b(kya kya|kay kay|kaun kaun|which|list|types?|variety|varieties)\b.{0,25}\b(saree|sari|salwar suit|salwar)\b/.test(
      q,
    )
  ) {
    return "category_details";
  }
  if (
    /\b(hai kya|available|mil jayega|milta hai|do you have|have any|rakhte|stock me|stock mein)\b/.test(
      q,
    ) ||
    /\bhai\b.*\b(apke|aapke)\b.*\b(pass|paas)\b/.test(q)
  ) {
    return "availability";
  }
  if (
    /\b(kya kya|kay kay|what.*(sell|have|available)|categories|category|collection|collections|milta|milega|milenge)\b/.test(
      q,
    ) ||
    /\b(apke|aapke|your)\s+(pass|paas|store)\b/.test(q)
  ) {
    return "overview";
  }
  return looksLikeShopping(message) ? "recommendation" : null;
}

/** Shopping / product-discovery signal (English + Hinglish). */
export function looksLikeShopping(message: string): boolean {
  return /\b(saree|sari|lehenga|lehnga|kurta|kurti|dupatta|blouse|salwar|suit|dress|gown|corset|top|shirt|silk|cotton|georgette|banarasi|chiffon|organza|linen|fabric|fabrics|price|prices|budget|under|below|above|between|rs\.?|rupees|cheap|sasta|saste|mehenga|dikha|dikhao|dekhna|chahiye|recommend|suggest|buy|khareed|kharid|gift|gifting|wedding|shaadi|bridal|festive|festival|party|colou?r|red|blue|green|pink|yellow|black|white|maroon|design|designs|latest|new arrival|arrivals|collection|collections|category|categories|show me|options|available|milta|milega|apke pass|aapke paas)\b/i.test(
    message,
  );
}

let catalogCache:
  | { expiresAt: number; value: RaniCatalogSummary }
  | undefined;

/** Authoritative storefront catalog facts. Never derive these from the LLM. */
export async function retrieveCatalogSummary(): Promise<RaniCatalogSummary> {
  if (catalogCache && catalogCache.expiresAt > Date.now()) {
    return catalogCache.value;
  }

  const [categories, subcategories, fabrics, categoryFabrics, totals] =
    await Promise.all([
      Product.aggregate<{ _id: string; count: number }>([
        { $match: STOREFRONT_FILTER },
        { $match: { category: { $type: "string", $ne: "" } } },
        { $group: { _id: "$category", count: { $sum: 1 } } },
        { $sort: { count: -1, _id: 1 } },
      ]),
      Product.aggregate<{ _id: { name: string; category: string }; count: number }>([
        { $match: STOREFRONT_FILTER },
        { $match: { subcategory: { $type: "string", $ne: "" } } },
        {
          $group: {
            _id: { name: "$subcategory", category: "$category" },
            count: { $sum: 1 },
          },
        },
        { $sort: { count: -1, "_id.name": 1 } },
      ]),
      Product.aggregate<{ _id: string; count: number }>([
        { $match: STOREFRONT_FILTER },
        { $match: { fabric: { $type: "string", $ne: "" } } },
        { $group: { _id: "$fabric", count: { $sum: 1 } } },
        { $sort: { count: -1, _id: 1 } },
      ]),
      Product.aggregate<{
        _id: { category: string; fabric: string };
        count: number;
      }>([
        { $match: STOREFRONT_FILTER },
        {
          $match: {
            category: { $type: "string", $ne: "" },
            fabric: { $type: "string", $ne: "" },
          },
        },
        {
          $group: {
            _id: { category: "$category", fabric: "$fabric" },
            count: { $sum: 1 },
          },
        },
        { $sort: { count: -1 } },
      ]),
      Product.aggregate<{
        _id: null;
        totalProducts: number;
        minPrice: number;
        maxPrice: number;
      }>([
        { $match: STOREFRONT_FILTER },
        {
          $group: {
            _id: null,
            totalProducts: { $sum: 1 },
            minPrice: { $min: "$price" },
            maxPrice: { $max: "$price" },
          },
        },
      ]),
    ]);

  const byCategory = new Map<
    string,
    Array<{ name: string; count: number }>
  >();
  for (const row of categoryFabrics) {
    const list = byCategory.get(row._id.category) || [];
    list.push({ name: row._id.fabric, count: row.count });
    byCategory.set(row._id.category, list);
  }

  const total = totals[0];
  const value: RaniCatalogSummary = {
    totalProducts: total?.totalProducts || 0,
    categories: categories.map((x) => ({ name: x._id, count: x.count })),
    subcategories: subcategories.map((x) => ({
      name: x._id.name,
      category: x._id.category,
      count: x.count,
    })),
    fabrics: fabrics.map((x) => ({ name: x._id, count: x.count })),
    fabricsByCategory: [...byCategory.entries()].map(([category, list]) => ({
      category,
      fabrics: list,
    })),
    priceRange: {
      min: Number.isFinite(total?.minPrice) ? total.minPrice : null,
      max: Number.isFinite(total?.maxPrice) ? total.maxPrice : null,
    },
  };
  catalogCache = { expiresAt: Date.now() + 60_000, value };
  return value;
}

/** Order / delivery signal (English + Hinglish). */
export function looksLikeOrderQuery(message: string): boolean {
  return /\b(order|orders|delivery|deliver|delivered|track|tracking|awb|parcel|courier|shipment|shipped|status|kaha|kahan|kab|refund|return|cancel|invoice|receipt|mera saman|mera order|mere order|meri order|my order)\b/i.test(
    message,
  );
}

function parseMoney(raw: string): number | null {
  const m = raw.replace(/[, ]/g, "").match(/^(\d+(?:\.\d+)?)(k)?$/i);
  if (!m) return null;
  let n = parseFloat(m[1]);
  if (m[2]) n *= 1000;
  if (!Number.isFinite(n) || n <= 0 || n > 10_000_000) return null;
  return Math.round(n);
}

/** Fix common budget-word typos before parsing (unr/undr → under, belw → below). */
function normalizeBudgetTypos(t: string): string {
  return t
    .replace(/\b(unr|undr|uder|undar|andar)\b/g, "under")
    .replace(/\b(belw|blow|bilow)\b/g, "below")
    .replace(/\b(abve|abov)\b/g, "above");
}

/** Extract a { min, max } budget from natural language (English + Hinglish). */
export function parsePriceRange(message: string): { min?: number; max?: number } {
  const t = normalizeBudgetTypos(message.toLowerCase());
  const num = "([\\d,]+(?:\\.\\d+)?k?)";

  // between X and Y / X to Y / X-Y
  let m =
    t.match(new RegExp(`between\\s*(?:rs\\.?|₹)?\\s*${num}\\s*(?:and|to|-|–)\\s*(?:rs\\.?|₹)?\\s*${num}`)) ||
    t.match(new RegExp(`(?:rs\\.?|₹)\\s*${num}\\s*(?:to|-|–)\\s*(?:rs\\.?|₹)?\\s*${num}`)) ||
    t.match(new RegExp(`${num}\\s*(?:to|-|–)\\s*${num}\\s*(?:rs|rupees|₹|ka|budget)`));
  if (m) {
    const a = parseMoney(m[1]);
    const b = parseMoney(m[2]);
    if (a != null && b != null) return { min: Math.min(a, b), max: Math.max(a, b) };
  }

  // max: under / below / less than / upto / within / se kam / se neeche / tak
  m =
    t.match(new RegExp(`(?:under|below|less than|upto|up to|within|max|maximum|budget of|budget)\\s*(?:rs\\.?|₹)?\\s*${num}`)) ||
    t.match(new RegExp(`(?:rs\\.?|₹)?\\s*${num}\\s*(?:se kam|se neeche|ke andar|ke neeche|tak|ke under)`));
  if (m) {
    const v = parseMoney(m[1]);
    if (v != null) return { max: v };
  }

  // min: above / over / more than / se zyada / se upar
  m =
    t.match(new RegExp(`(?:above|over|more than|greater than|minimum|min|starting)\\s*(?:rs\\.?|₹)?\\s*${num}`)) ||
    t.match(new RegExp(`(?:rs\\.?|₹)?\\s*${num}\\s*(?:se zyada|se upar|se jyada|se oopar|and above|\\+)`));
  if (m) {
    const v = parseMoney(m[1]);
    if (v != null) return { min: v };
  }

  return {};
}

/** Remove budget phrasing so the leftover text is a clean product query. */
function stripPriceWords(message: string): string {
  return message
    .replace(/\b(under|unr|undr|uder|below|belw|less than|upto|up to|within|above|abve|over|more than|between|and above|max|maximum|minimum|budget of|budget|starting|best)\b/gi, " ")
    .replace(/\b(se kam|se neeche|se zyada|se upar|se jyada|ke andar|ke neeche|ke under|tak)\b/gi, " ")
    .replace(/(?:rs\.?|₹)\s*[\d,]+k?/gi, " ")
    .replace(/\b[\d,]+k?\b/g, " ")
    .replace(/\b(rupees|rupee|price|budget|ka|ke|ki|mein|me)\b/gi, " ")
    .replace(/[-–]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function toCard(p: Record<string, unknown>): RaniProductCard {
  const images = p.images as Array<{ url?: string }> | undefined;
  const image = Array.isArray(images) && images[0]?.url ? images[0].url : undefined;
  const ratings = p.ratings as { average?: number } | undefined;
  return {
    name: String(p.name || ""),
    slug: String(p.slug || ""),
    priceInr: Number(p.price || 0),
    comparePriceInr:
      typeof p.comparePrice === "number" && p.comparePrice > Number(p.price || 0)
        ? p.comparePrice
        : undefined,
    image,
    category: p.category ? String(p.category) : undefined,
    fabric: p.fabric ? String(p.fabric) : undefined,
    inStock: Number(p.totalStock || 0) > 0,
    rating:
      ratings?.average && ratings.average > 0
        ? Math.round(ratings.average * 10) / 10
        : undefined,
  };
}

function productTypeHint(message: string):
  | { pattern: string; label: string }
  | undefined {
  return PRODUCT_TYPE_ALIASES.find((x) => x.re.test(message));
}

function fabricHint(message: string): string | undefined {
  const known = [
    "cotton",
    "silk",
    "chiffon",
    "georgette",
    "organza",
    "linen",
    "banarasi",
    "velvet",
    "chanderi",
    "jacquard",
  ];
  return known.find((x) => new RegExp(`\\b${x}\\b`, "i").test(message));
}

/** Retrieve the most relevant products for a shopper query (text + local vector). */
export async function retrieveProductsForQuery(
  message: string,
  limit = 6,
): Promise<RaniProductCard[]> {
  const { min, max } = parsePriceRange(message);
  const query = stripPriceWords(message);
  const kind = classifyCatalogQuestion(message);
  const typeHint = productTypeHint(message);
  const requestedFabric = fabricHint(message);

  const baseFilter: Record<string, unknown> = {
    ...STOREFRONT_FILTER,
    totalStock: { $gt: 0 },
  };
  if (min != null || max != null) {
    baseFilter.price = {
      ...(min != null ? { $gte: min } : {}),
      ...(max != null ? { $lte: max } : {}),
    };
  }
  if (typeHint) {
    const re = new RegExp(typeHint.pattern, "i");
    baseFilter.$or = [
      { name: re },
      { category: re },
      { subcategory: re },
      { tags: re },
    ];
  }
  if (requestedFabric) {
    baseFilter.fabric = new RegExp(requestedFabric, "i");
  }

  const results: Array<Record<string, unknown>> = [];
  const seen = new Set<string>();
  const push = (docs: Array<Record<string, unknown>>) => {
    for (const d of docs) {
      const id = String(d._id || d.slug || "");
      if (!id || seen.has(id)) continue;
      seen.add(id);
      results.push(d);
      if (results.length >= limit) break;
    }
  };

  // 1) Full-text relevance search (respecting the budget filter).
  if (query.length >= 2) {
    try {
      const textHits = await Product.find(
        { ...baseFilter, $text: { $search: query } },
        { score: { $meta: "textScore" } },
      )
        .select(CARD_SELECT)
        .sort({ score: { $meta: "textScore" } })
        .limit(limit * 2)
        .lean();
      push(textHits as Array<Record<string, unknown>>);
    } catch {
      /* text index missing → fall through to vector */
    }
  }

  // 2) Local vector re-rank only within a verified type/fabric/budget scope.
  // Never use semantic similarity to claim an unknown product type is available.
  const hasVerifiedScope =
    Boolean(typeHint || requestedFabric) || min != null || max != null;
  if (
    results.length < limit &&
    query.length >= 2 &&
    hasVerifiedScope &&
    kind !== "availability"
  ) {
    const pool = await Product.find(baseFilter)
      .select(`${CARD_SELECT} contentEmbedding`)
      .limit(300)
      .lean();
    const qv = embedText(query);
    const scored = (pool as Array<Record<string, unknown>>)
      .filter(
        (p) =>
          Array.isArray(p.contentEmbedding) &&
          (p.contentEmbedding as number[]).length > 0,
      )
      .map((p) => ({
        p,
        s: cosineSimilarity(qv, p.contentEmbedding as number[]),
      }))
      .filter((x) => x.s >= 0.08)
      .sort((a, b) => b.s - a.s)
      .map((x) => x.p);
    push(scored);
  }

  // 3) Best-seller fill is safe only inside an explicit verified scope.
  // A query such as "corset hai?" must stay empty rather than return sarees.
  if (
    results.length < limit &&
    hasVerifiedScope &&
    kind === "recommendation"
  ) {
    const fillers = await Product.find(baseFilter)
      .select(CARD_SELECT)
      .sort("-soldCount -ratings.average -createdAt")
      .limit(limit * 2)
      .lean();
    push(fillers as Array<Record<string, unknown>>);
  }

  return results.slice(0, limit).map(toCard);
}

function isoDay(d?: Date | string | null): string | null {
  if (!d) return null;
  const date = new Date(d);
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
}

/** Fetch the shopper's orders (all recent, not capped at 5) for grounded answers. */
export async function retrieveUserOrders(
  userId: string,
  limit = 50,
): Promise<RaniOrderSummary[]> {
  const orders = await Order.find({ user: userId })
    .sort("-createdAt")
    .limit(limit)
    .select(
      "orderNumber status paymentStatus paymentMethod total createdAt items.name items.quantity trackingNumber shippingCarrier returnStatus deliveredAt",
    )
    .lean();

  return (orders as Array<Record<string, unknown>>).map((o) => {
    const items = (o.items as Array<{ name?: string; quantity?: number }>) || [];
    return {
      orderNumber: String(o.orderNumber || ""),
      status: String(o.status || ""),
      paymentStatus: o.paymentStatus ? String(o.paymentStatus) : undefined,
      paymentMethod: o.paymentMethod ? String(o.paymentMethod) : undefined,
      totalInr: Number(o.total || 0),
      placedOn: isoDay(o.createdAt as string) || "",
      items: items
        .slice(0, 6)
        .map((i) => `${i.name}${i.quantity ? ` x${i.quantity}` : ""}`),
      tracking: (o.trackingNumber as string) || null,
      carrier: (o.shippingCarrier as string) || null,
      returnStatus: o.returnStatus ? String(o.returnStatus) : undefined,
      deliveredOn: isoDay(o.deliveredAt as string),
    };
  });
}
