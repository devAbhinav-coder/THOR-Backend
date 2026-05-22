import { parseJsonFromModel } from './groqClient';

export type NormalizedProductDraft = {
  shortDescription: string;
  description: string;
  seoTitle: string;
  seoDescription: string;
  tags: string[];
  productDetailKeys: string;
  productDetailValues: string;
};

function linesFromBulkField(raw: unknown): string {
  if (Array.isArray(raw)) return raw.map(String).filter(Boolean).join('\n');
  return String(raw || '').trim();
}

export function normalizeProductDraft(
  raw: string,
): NormalizedProductDraft {
  const parsed = parseJsonFromModel<Record<string, unknown>>(raw);
  const p = parsed || {};

  let description = String(p.description || p.longDescription || p.body || '').trim();
  let shortDescription = String(p.shortDescription || p.short_desc || '').trim();
  let seoTitle = String(p.seoTitle || p.seo_title || p.metaTitle || '').trim();
  let seoDescription = String(
    p.seoDescription || p.seo_description || p.metaDescription || '',
  ).trim();

  let tags: string[] = [];
  if (Array.isArray(p.tags)) {
    tags = p.tags.map(String).map((t) => t.trim()).filter(Boolean).slice(0, 12);
  } else if (typeof p.tags === 'string') {
    tags = p.tags.split(/[,|]/).map((t) => t.trim()).filter(Boolean).slice(0, 12);
  }

  let productDetailKeys = linesFromBulkField(p.productDetailKeys || p.detailKeys);
  let productDetailValues = linesFromBulkField(p.productDetailValues || p.detailValues);

  if (Array.isArray(p.productDetails)) {
    const pairs = p.productDetails as { key?: string; value?: string }[];
    productDetailKeys = pairs.map((x) => String(x.key || '').trim()).filter(Boolean).join('\n');
    productDetailValues = pairs.map((x) => String(x.value || '').trim()).filter(Boolean).join('\n');
  }

  if (!description && raw && !raw.trim().startsWith('{')) {
    description = raw.trim();
  }

  if (!description && parsed) {
    description = String(p.text || '').trim();
  }

  if (!shortDescription && description) {
    const plain = description.replace(/^[-•*]\s+/gm, '').replace(/\n+/g, ' ').trim();
    const sentences = plain.split(/(?<=[.!?।])\s+/).filter((s) => s.length > 12);
    let out = '';
    for (const s of sentences) {
      const next = out ? `${out} ${s}` : s;
      if (next.length > 220) break;
      out = next;
      if (out.length >= 110) break;
    }
    shortDescription = (out || plain).slice(0, 220);
  }

  return {
    shortDescription: shortDescription.slice(0, 220),
    description: description.slice(0, 4000),
    seoTitle: seoTitle.slice(0, 70),
    seoDescription: seoDescription.slice(0, 170),
    tags,
    productDetailKeys: productDetailKeys.slice(0, 1500),
    productDetailValues: productDetailValues.slice(0, 1500),
  };
}
