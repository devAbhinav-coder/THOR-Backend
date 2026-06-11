import crypto from "crypto";
import mongoose from "mongoose";
import Product from "../models/Product";
import { deleteCache, getCache, setCache } from "./cacheService";
import { redisConnection } from "../config/redis";
import logger from "../types/utils/logger";

const VERSION_KEY = "cache:products:namespace:version";
const VERSION_TTL_SEC = 7 * 24 * 3600;

/** In-process fallback when Redis is unavailable. */
let memoryVersion = 1;

export async function getProductCacheVersion(): Promise<number> {
  try {
    const raw = await getCache<number>(VERSION_KEY);
    if (typeof raw === "number" && raw > 0) return raw;
  } catch {
    /* use memory */
  }
  return memoryVersion;
}

/** Bump namespace — avoids Redis KEYS / wildcard deletes. */
export async function bumpProductCacheVersion(): Promise<number> {
  const current = await getProductCacheVersion();
  const next = current + 1;
  memoryVersion = next;
  try {
    await setCache(VERSION_KEY, next, VERSION_TTL_SEC);
  } catch {
    /* memory only */
  }
  return next;
}

export async function buildVersionedKey(parts: string[]): Promise<string> {
  const v = await getProductCacheVersion();
  return `cache:v${v}:${parts.join(":")}`;
}

export function countCacheKey(
  version: number,
  filter: Record<string, unknown>,
): string {
  const str = JSON.stringify(filter);
  const hash = crypto.createHash("md5").update(str).digest("hex");
  return `cache:v${version}:products:count:${hash}`;
}

export function pdpCacheKey(version: number, slug: string): string {
  return `cache:v${version}:product:slug:${slug}`;
}

export function featuredCacheKey(version: number): string {
  return `cache:v${version}:products:featured`;
}

export function filtersCacheKey(version: number, category?: string): string {
  const scoped = String(category || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return scoped ?
      `cache:v${version}:products:filters:cat:${scoped}`
    : `cache:v${version}:products:filters`;
}

export function randomPoolCountKey(
  version: number,
  excludeHash: string,
): string {
  return `cache:v${version}:products:random:pool:${excludeHash}`;
}

/** Invalidate a single PDP entry (stock/price change) without bumping the global listing namespace. */
export async function invalidatePdpBySlug(slug: string): Promise<void> {
  if (!slug?.trim()) return;
  try {
    const v = await getProductCacheVersion();
    await deleteCache(pdpCacheKey(v, slug.trim()));
  } catch (err) {
    logger.warn(
      `PDP cache invalidate failed (${slug}): ${(err as Error).message}`,
    );
  }
}

/** After inventory mutation — refresh PDP only for that product. */
export async function invalidatePdpForProductId(
  productId: mongoose.Types.ObjectId | string,
): Promise<void> {
  try {
    const doc = await Product.findById(productId)
      .select("slug")
      .lean<{ slug?: string }>();
    if (doc?.slug) {
      await invalidatePdpBySlug(doc.slug);
    }
  } catch (err) {
    logger.warn(
      `PDP cache invalidate by product id failed (${String(productId)}): ${(err as Error).message}`,
    );
  }
}

/** Fire-and-forget PDP invalidation (checkout / inventory hot paths). */
export function schedulePdpInvalidationForProductId(
  productId: mongoose.Types.ObjectId | string,
): void {
  void invalidatePdpForProductId(productId);
}

/**
 * Full catalog invalidation — product create/update/delete, category changes.
 * Bumps version so listings, filters, search, and random pools refresh.
 */
export async function invalidateProductCaches(opts?: {
  slug?: string;
}): Promise<void> {
  await bumpProductCacheVersion();
  if (opts?.slug) {
    await invalidatePdpBySlug(opts.slug);
  }
}
