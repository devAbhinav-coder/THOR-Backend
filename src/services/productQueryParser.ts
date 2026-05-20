import { Request } from "express";
import { env } from "../config/env";

export const SEARCH_MAX_LEN = 30;

/** Unicode-safe search string for storefront/admin. */
export function normalizeSearchQuery(raw: unknown): string {
  if (typeof raw !== "string") return "";
  return raw
    .normalize("NFC")
    .trim()
    .replace(/[\x00-\x1f]/g, "")
    .slice(0, SEARCH_MAX_LEN);
}

export type ParsedProductListQuery = {
  page: number;
  limit: number;
  sort: string;
  search: string;
  category?: string;
  fabric?: string;
  minPrice?: number;
  maxPrice?: number;
  minRating?: number;
  isFeatured?: boolean;
  /** Admin catalog only — filter by active/inactive when set. */
  isActive?: boolean;
  isRandom: boolean;
  excludeIds: string[];
  /** Admin catalog — includes inactive / gifting / offline-tagged when true. */
  adminScope: boolean;
};

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

  const category =
    typeof q.category === "string" && q.category.trim() ?
      q.category.trim()
    : undefined;

  const fabric =
    typeof q.fabric === "string" && q.fabric.trim() ?
      q.fabric.trim()
    : undefined;

  const minPriceRaw = q.minPrice ?? (q as Record<string, string>)["price[gte]"];
  const maxPriceRaw = q.maxPrice ?? (q as Record<string, string>)["price[lte]"];
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
  const minRating =
    minRatingParsed !== undefined &&
    Number.isFinite(minRatingParsed) &&
    minRatingParsed >= 1 &&
    minRatingParsed <= 5 ?
      minRatingParsed
    : undefined;

  const isFeaturedRaw = q.isFeatured;
  const isFeatured =
    isFeaturedRaw === "true" || isFeaturedRaw === true ? true
    : isFeaturedRaw === "false" || isFeaturedRaw === false ? false
    : sort === "featured" ? true
    : undefined;

  const isActiveRaw = q.isActive;
  const isActive =
    isActiveRaw === "true" || isActiveRaw === true ? true
    : isActiveRaw === "false" || isActiveRaw === false ? false
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
    category,
    fabric,
    minPrice: Number.isFinite(minPrice) ? minPrice : undefined,
    maxPrice: Number.isFinite(maxPrice) ? maxPrice : undefined,
    minRating,
    isFeatured,
    isActive,
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
  if (sort === "-ratings.average") {
    return { sortBy: "ratings.average", sortOrder: "desc" };
  }
  if (sort === "-ratings.count") {
    return { sortBy: "soldCount", sortOrder: "desc" };
  }
  if (sort === "featured" || sort === "-isFeatured") {
    return { sortBy: "createdAt", sortOrder: "desc" };
  }
  if (sort.startsWith("-")) {
    return { sortBy: sort.slice(1), sortOrder: "desc" };
  }
  return { sortBy: sort || "createdAt", sortOrder: "asc" };
}
