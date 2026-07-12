import logger from "../types/utils/logger";

const INDEXNOW_API = "https://api.indexnow.org/indexnow";
const BING_INDEXNOW_API = "https://www.bing.com/indexnow";

function getSiteOrigin(): string | null {
  const raw = (
    process.env.FRONTEND_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    "https://www.thehouseofrani.com"
  ).trim();
  try {
    return new URL(raw).origin;
  } catch {
    return null;
  }
}

function toAbsoluteUrl(pathOrUrl: string): string | null {
  const origin = getSiteOrigin();
  if (!origin) return null;
  const trimmed = pathOrUrl.trim();
  if (!trimmed) return null;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `${origin}${trimmed.startsWith("/") ? trimmed : `/${trimmed}`}`;
}

async function postIndexNow(body: Record<string, unknown>): Promise<void> {
  const endpoints = [INDEXNOW_API, BING_INDEXNOW_API];
  await Promise.allSettled(
    endpoints.map(async (endpoint) => {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json; charset=utf-8" },
        body: JSON.stringify(body),
      });
      if (!res.ok && res.status !== 202) {
        logger.warn("IndexNow submission returned non-success", {
          endpoint,
          status: res.status,
        });
      }
    }),
  );
}

function buildIndexNowPayload(pathsOrUrls: string[]): Record<string, unknown> | null {
  const key =
    process.env.INDEXNOW_API_KEY?.trim() ||
    process.env.NEXT_PUBLIC_INDEXNOW_API_KEY?.trim();
  if (!key) return null;

  const origin = getSiteOrigin();
  if (!origin) return null;

  let host: string;
  try {
    host = new URL(origin).host;
  } catch {
    return null;
  }

  const urlList = [
    ...new Set(
      pathsOrUrls
        .map(toAbsoluteUrl)
        .filter((url): url is string => Boolean(url)),
    ),
  ].slice(0, 10_000);

  if (!urlList.length) return null;

  return {
    host,
    key,
    keyLocation: `${origin}/${key}.txt`,
    urlList,
  };
}

/** Fire-and-forget URL notification for Bing/Yandex IndexNow. */
export function notifyIndexNow(pathsOrUrls: string[]): void {
  const payload = buildIndexNowPayload(pathsOrUrls);
  if (!payload) return;

  void postIndexNow(payload).catch((err: unknown) => {
    logger.warn("IndexNow submission failed", { err });
  });
}

/** Awaitable batch submit — use in one-off scripts. */
export async function notifyIndexNowAsync(
  pathsOrUrls: string[],
): Promise<void> {
  const payload = buildIndexNowPayload(pathsOrUrls);
  if (!payload) return;
  await postIndexNow(payload);
}

export function notifyIndexNowStorefront(path: string): void {
  notifyIndexNow([path]);
}
