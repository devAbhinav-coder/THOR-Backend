import type { Response } from "express";

/** CDN/browser caching for public catalog GET responses (matches feed pattern). */
export function setPublicCatalogCacheHeaders(
  res: Response,
  opts?: { maxAgeSec?: number; staleWhileRevalidateSec?: number },
): void {
  const maxAge = opts?.maxAgeSec ?? 120;
  const swr = opts?.staleWhileRevalidateSec ?? 600;
  res.setHeader(
    "Cache-Control",
    `public, max-age=${maxAge}, s-maxage=${maxAge}, stale-while-revalidate=${swr}`,
  );
}

export function setPrivateNoStore(res: Response): void {
  res.setHeader("Cache-Control", "private, no-store");
}
