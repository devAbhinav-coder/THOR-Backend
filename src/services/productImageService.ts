import type { IProductImage } from '../types';

export const MAX_PRODUCT_IMAGES = 20;

export type ImageMetaEntry = {
  publicId?: string;
  color?: string;
  alt?: string;
};

export function parseImagesMeta(raw: unknown): ImageMetaEntry[] {
  if (!raw) return [];
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw) as ImageMetaEntry[];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return Array.isArray(raw) ? (raw as ImageMetaEntry[]) : [];
}

function normPublicId(id: string): string {
  const trimmed = id.trim();
  try {
    return decodeURIComponent(trimmed).replace(/^\/+/, '');
  } catch {
    return trimmed.replace(/^\/+/, '');
  }
}

function findExistingImage(
  existing: IProductImage[],
  publicId?: string,
): IProductImage | undefined {
  if (!publicId?.trim()) return undefined;
  const target = normPublicId(publicId);
  const direct = existing.find((i) => normPublicId(i.publicId) === target);
  if (direct) return direct;
  return existing.find((i) => {
    const pid = normPublicId(i.publicId);
    return pid.endsWith(target) || target.endsWith(pid);
  });
}

export function distinctVariantColors(
  variants: { color?: string }[] | undefined,
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of variants || []) {
    const c = String(v.color ?? '').trim();
    const key = c.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(c);
  }
  return out;
}

/** Multi-shade products must tag every image with its color in imagesMeta. */
export function validateImagesMetaForVariants(
  meta: ImageMetaEntry[],
  variants: { color?: string }[] | undefined,
): string | null {
  if (distinctVariantColors(variants).length < 2) return null;
  if (!meta.length) return null;
  for (const [i, entry] of meta.entries()) {
    if (!colorFromMeta(entry)) {
      return `Image ${i + 1} must be linked to a color (product has multiple shades). Fill color names and save again.`;
    }
  }
  return null;
}

function colorFromMeta(entry: ImageMetaEntry): string | undefined {
  const c = String(entry.color ?? '').trim();
  return c || undefined;
}

export function countNewImageMetaSlots(meta: ImageMetaEntry[]): number {
  return meta.filter((e) => !e.publicId?.trim()).length;
}

export function buildImagesFromMeta(
  meta: ImageMetaEntry[],
  uploaded: { url: string; publicId: string }[],
  productName: string,
  existing: IProductImage[] = [],
): IProductImage[] {
  if (!meta.length && uploaded.length) {
    return uploaded.map((img, index) => ({
      url: img.url,
      publicId: img.publicId,
      alt: `${productName} - Image ${index + 1}`,
    }));
  }

  let uploadIdx = 0;
  const built: IProductImage[] = [];

  for (const [index, entry] of meta.entries()) {
    const color = colorFromMeta(entry);

    if (entry.publicId?.trim()) {
      const prev = findExistingImage(existing, entry.publicId);
      if (!prev?.url) continue;
      built.push({
        url: prev.url,
        publicId: prev.publicId,
        alt: entry.alt || prev.alt || `${productName} - Image ${index + 1}`,
        ...(color ? { color } : {}),
      });
      continue;
    }

    const up = uploaded[uploadIdx++];
    if (!up) continue;
    built.push({
      url: up.url,
      publicId: up.publicId,
      alt: entry.alt || `${productName} - Image ${index + 1}`,
      ...(color ? { color } : {}),
    });
  }

  return built;
}
