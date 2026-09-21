import crypto from "crypto";
import type { ParsedProductListQuery } from "../productQueryParser";
import { getProductCacheVersion } from "../productCacheService";

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(",")}}`;
}

/** Shop PLP (non-search, non-random, storefront) list body cache key. */
export async function buildShopListCacheKey(
  parsed: ParsedProductListQuery,
  reqQuery: Record<string, string | undefined>,
): Promise<string | null> {
  if (parsed.adminScope || parsed.isRandom || parsed.search.trim()) {
    return null;
  }

  const v = await getProductCacheVersion();
  const queryFingerprint = Object.keys(reqQuery)
    .sort()
    .reduce<Record<string, string | undefined>>((acc, key) => {
      const val = reqQuery[key];
      if (val !== undefined && val !== "") {
        acc[key] = val;
      }
      return acc;
    }, {});

  const hash = crypto
    .createHash("md5")
    .update(stableStringify({ parsed, queryFingerprint }))
    .digest("hex");

  return `cache:v${v}:shop-list:env:${hash}`;
}
