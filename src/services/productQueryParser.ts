import { Request } from "express";
import { env } from "../config/env";

export const SEARCH_MAX_LEN = 80;

/** Unicode-safe search string for storefront/admin. */
export function normalizeSearchQuery(raw: unknown): string {
  if (typeof raw !== "string") return "";
  return raw
    .normalize("NFC")
    .trim()
    .replace(/[\x00-\x1f]/g, "")
    .replace(/\s*[·•|,]+\s*/g, " ")
    .replace(/\s+/g, " ")
    .slice(0, SEARCH_MAX_LEN);
}

export type ParsedProductListQuery = {
  page: number;
  limit: number;
  sort: string;
  search: string;
  categories: string[];
  subcategories: string[];
  colors: string[];
  fabrics: string[];
  occasions: string[];
  minPrice?: number;
  maxPrice?: number;
  minRatings: number[];
  minRating?: number;
  isFeatured?: boolean;
  /** Storefront — products where comparePrice > price OR covered by active sale campaign */
  onSale?: boolean;
  /** Storefront — products in scope of an active targeted coupon offer */
  hasOffer?: boolean;
  /** Admin catalog only — filter by active/inactive when set. */
  isActive?: boolean;
  /** Admin/storefront — Premium Edit only when true; exclude premium when false. */
  isPremium?: boolean;
  isRandom: boolean;
  excludeIds: string[];
  /** Admin catalog — includes inactive / gifting / offline-tagged when true. */
  adminScope: boolean;
};

function parseQueryStringList(
  q: Record<string, unknown>,
  ...keys: string[]
): string[] {
  const values: string[] = [];
  for (const key of keys) {
    const raw = q[key];
    if (raw === undefined || raw === null) continue;
    const parts = Array.isArray(raw) ? raw : [raw];
    for (const part of parts) {
      if (typeof part !== "string") continue;
      for (const segment of part.split(",")) {
        const trimmed = segment.trim();
        if (trimmed) values.push(trimmed);
      }
    }
  }
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const value of values) {
    const dedupeKey = value.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (!dedupeKey || seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    unique.push(value);
  }
  return unique;
}

function parseRatingList(q: Record<string, unknown>): number[] {
  return parseQueryStringList(q, "ratings", "rating", "minRating")
    .map((raw) => Number.parseInt(raw, 10))
    .filter((n) => Number.isFinite(n) && n >= 1 && n <= 5);
}

function parsePositiveInt(raw: unknown, fallback: number, max: number): number {
  const n = Number.parseInt(String(raw ?? ""), 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(1, n), max);
}

export function parseProductListQuery(req: Request): ParsedProductListQuery {
  const maxLimit = env.pagination.maxLimit;
  const defaultLimit = env.pagination.defaultLimit;

  const q = req.query as Record<string, unknown>;
  const page = parsePositiveInt(q.page, 1, 10_000);
  const limit = parsePositiveInt(q.limit, defaultLimit, maxLimit);

  const search =
    normalizeSearchQuery(q.search) ||
    normalizeSearchQuery(q.q);

  const sort =
    typeof q.sort === "string" && q.sort.trim() ?
      q.sort.trim()
    : "-createdAt";

  const categories = parseQueryStringList(q, "categories", "category");
  const subcategories = parseQueryStringList(q, "subcategories", "subcategory");
  const colors = parseQueryStringList(q, "colors", "color");
  const fabrics = parseQueryStringList(q, "fabrics", "fabric");
  const occasions = parseQueryStringList(q, "occasions", "occasion", "occasions");
  const minRatings = parseRatingList(q);
  const minRating =
    minRatings.length > 0 ? Math.min(...minRatings) : undefined;

  const minPriceRaw = q.minPrice ?? (q.price as Record<string, unknown>)?.gte ?? q["price[gte]"];
  const maxPriceRaw = q.maxPrice ?? (q.price as Record<string, unknown>)?.lte ?? q["price[lte]"];
  const minPrice =
    minPriceRaw !== undefined && minPriceRaw !== "" ?
      Number(minPriceRaw)
    : undefined;
  const maxPrice =
    maxPriceRaw !== undefined && maxPriceRaw !== "" ?
      Number(maxPriceRaw)
    : undefined;

  const minRatingRaw = q.minRating;
  const minRatingParsed =
    minRatingRaw !== undefined && minRatingRaw !== "" ?
      Number.parseInt(String(minRatingRaw), 10)
    : undefined;
  const legacyMinRating =
    minRatingParsed !== undefined &&
    Number.isFinite(minRatingParsed) &&
    minRatingParsed >= 1 &&
    minRatingParsed <= 5 ?
      minRatingParsed
    : undefined;
  const resolvedMinRating = minRating ?? legacyMinRating;
  const resolvedMinRatings =
    minRatings.length > 0 ?
      minRatings
    : resolvedMinRating !== undefined ?
      [resolvedMinRating]
    : [];

  const isFeaturedRaw = q.isFeatured;
  const isFeatured =
    isFeaturedRaw === "true" || isFeaturedRaw === true ? true
    : isFeaturedRaw === "false" || isFeaturedRaw === false ? false
    : sort === "featured" ? true
    : undefined;

  const onSaleRaw = q.onSale;
  const onSale =
    onSaleRaw === "true" || onSaleRaw === true ? true
    : onSaleRaw === "false" || onSaleRaw === false ? false
    : undefined;

  const hasOfferRaw = q.hasOffer;
  const hasOffer =
    hasOfferRaw === "true" || hasOfferRaw === true ? true
    : hasOfferRaw === "false" || hasOfferRaw === false ? false
    : undefined;

  const isActiveRaw = q.isActive;
  const isActive =
    isActiveRaw === "true" || isActiveRaw === true ? true
    : isActiveRaw === "false" || isActiveRaw === false ? false
    : undefined;

  const isPremiumRaw = q.isPremium;
  const isPremium =
    isPremiumRaw === "true" || isPremiumRaw === true ? true
    : isPremiumRaw === "false" || isPremiumRaw === false ? false
    : undefined;

  const isRandom = q.isRandom === "true" || q.isRandom === true;

  const excludeIds =
    typeof q.excludeIds === "string" ?
      q.excludeIds.split(",").map((s) => s.trim()).filter(Boolean)
    : [];


  return {
    page,
    limit,
    sort,
    search,
    categories,
    subcategories,
    colors,
    fabrics,
    occasions,
    minPrice: Number.isFinite(minPrice) ? minPrice : undefined,
    maxPrice: Number.isFinite(maxPrice) ? maxPrice : undefined,
    minRatings: resolvedMinRatings,
    minRating: resolvedMinRating,
    isFeatured,
    onSale,
    hasOffer,
    isActive,
    isPremium,
    isRandom,
    excludeIds,
    adminScope: false,
  };
}

/** Map storefront `sort` query to advanced search sort fields. */
export function mapSortToAdvanced(sort: string): {
  sortBy: string;
  sortOrder: "asc" | "desc";
} {
  if (sort === "price") return { sortBy: "price", sortOrder: "asc" };
  if (sort === "-price") return { sortBy: "price", sortOrder: "desc" };
  if (sort === "-ratings.average" || sort === "ratings.average") {
    return { sortBy: "ratings.average", sortOrder: "desc" };
  }
  if (sort === "-ratings.count" || sort === "-soldCount") {
    return { sortBy: "soldCount", sortOrder: "desc" };
  }
  if (sort === "ratings.count" || sort === "soldCount") {
    return { sortBy: "soldCount", sortOrder: "asc" };
  }
  if (sort === "featured" || sort === "-isFeatured") {
    return { sortBy: "createdAt", sortOrder: "desc" };
  }
  if (sort === "-createdAt") {
    return { sortBy: "createdAt", sortOrder: "desc" };
  }
  if (sort.startsWith("-")) {
    return { sortBy: sort.slice(1), sortOrder: "desc" };
  }
  return { sortBy: sort || "createdAt", sortOrder: "asc" };
}

/** Normalize shop listing sort for Mongo/APIFeatures (non-search). */
export function normalizeShopListSort(sort: string): string {
  if (!sort || sort === "featured") return "-isFeatured,-createdAt";
  if (sort === "-ratings.count" || sort === "ratings.count") {
    return sort.startsWith("-") ? "-soldCount" : "soldCount";
  }
  return sort;
}

/** Resolve search sort from explicit sortBy/sortOrder or legacy sort param. */
export function resolveShopSearchSort(
  sort: string,
  explicitSortBy?: string,
  explicitSortOrder?: string,
): { sortBy: string; sortOrder: "asc" | "desc" } {
  if (
    explicitSortBy &&
    (explicitSortOrder === "asc" || explicitSortOrder === "desc")
  ) {
    return { sortBy: explicitSortBy, sortOrder: explicitSortOrder };
  }
  return mapSortToAdvanced(sort || explicitSortBy || "-createdAt");
}
