import type { NormalizedProductDraft } from './productDraftNormalize';

type DetailRow = { key: string; value: string };

function parseDetailRows(keys: string, values: string): DetailRow[] {
  const kLines = keys.split('\n').map((s) => s.trim()).filter(Boolean);
  const vLines = values.split('\n').map((s) => s.trim());
  const rows: DetailRow[] = [];
  for (let i = 0; i < kLines.length; i++) {
    rows.push({ key: kLines[i], value: vLines[i] || '' });
  }
  return rows;
}

function serializeDetailRows(rows: DetailRow[]): { keys: string; values: string } {
  return {
    keys: rows.map((r) => r.key).join('\n'),
    values: rows.map((r) => r.value).join('\n'),
  };
}

function upsertDetailRow(rows: DetailRow[], key: string, value: string): DetailRow[] {
  const v = value.trim();
  if (!v) return rows;
  const idx = rows.findIndex((r) => r.key.toLowerCase() === key.toLowerCase());
  if (idx >= 0) rows[idx] = { key: rows[idx].key, value: v };
  else rows.push({ key, value: v });
  return rows;
}

function buildShortFromDescription(description: string, minLen = 110, maxLen = 220): string {
  const plain = description
    .replace(/^[-•*]\s+/gm, '')
    .replace(/\n+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!plain) return '';

  const sentences = plain.split(/(?<=[.!?।])\s+/).filter((s) => s.length > 12);
  let out = '';
  for (const s of sentences) {
    const next = out ? `${out} ${s}` : s;
    if (next.length > maxLen) break;
    out = next;
    if (out.length >= minLen) break;
  }
  if (out.length < minLen) out = plain.slice(0, maxLen);
  return out.trim();
}

function inferLength(category?: string, subcategory?: string, designNotes?: string): string | null {
  const notes = (designNotes || '').toLowerCase();
  const m = notes.match(/(\d+(?:\.\d+)?)\s*(?:m|meter|metre|mtr)/i);
  if (m) return `${m[1]} metres (approx.)`;

  const cat = `${category || ''} ${subcategory || ''}`.toLowerCase();
  if (cat.includes('saree') || cat.includes('sari')) return '5.5 metres (approx.)';
  if (cat.includes('dupatta')) return '2.5 metres (approx.)';
  return null;
}

function inferWork(designNotes?: string): string | null {
  const n = (designNotes || '').trim();
  if (n.length < 4) return null;
  return n.slice(0, 120);
}

export function enrichProductDraft(
  norm: NormalizedProductDraft,
  input: {
    name: string;
    fabric?: string;
    category?: string;
    subcategory?: string;
    designNotes?: string;
    variants?: Array<{ color?: string; size?: string }>;
  },
): NormalizedProductDraft {
  let shortDescription = norm.shortDescription.trim();
  const description = norm.description.trim();
  let seoTitle = norm.seoTitle.trim();
  let seoDescription = norm.seoDescription.trim();
  let { productDetailKeys, productDetailValues } = norm;
  let tags = [...norm.tags];

  if (shortDescription.length < 110 && description) {
    shortDescription = buildShortFromDescription(description);
  }
  if (shortDescription.length < 80 && description) {
    shortDescription = buildShortFromDescription(description, 80, 220);
  }

  if (!seoTitle) {
    seoTitle = `${input.name} | The House of Rani`.slice(0, 60);
  }
  if (!seoDescription) {
    seoDescription = (shortDescription || description).slice(0, 160);
  }
  if (seoDescription.length < 100 && description) {
    seoDescription = buildShortFromDescription(description, 100, 160);
  }

  let rows = parseDetailRows(productDetailKeys, productDetailValues);
  const fabric = input.fabric?.trim();
  if (fabric) rows = upsertDetailRow(rows, 'Fabric', fabric);

  const work = inferWork(input.designNotes);
  if (work && !rows.some((r) => r.key.toLowerCase() === 'work')) {
    rows = upsertDetailRow(rows, 'Work', work);
  }

  const lengthVal = inferLength(input.category, input.subcategory, input.designNotes);
  if (lengthVal && !rows.some((r) => r.key.toLowerCase() === 'length')) {
    rows = upsertDetailRow(rows, 'Length', lengthVal);
  }

  const mainColor = input.variants?.find((v) => v.color?.trim())?.color?.trim();
  if (mainColor && !rows.some((r) => r.key.toLowerCase() === 'color')) {
    rows = upsertDetailRow(rows, 'Color', mainColor);
  }

  if (!rows.some((r) => r.key.toLowerCase() === 'care')) {
    rows = upsertDetailRow(rows, 'Care', 'Dry clean recommended; store in a cool dry place');
  }

  if (rows.length < 4) {
    const defaults: DetailRow[] = [
      { key: 'Fabric', value: fabric || 'See description' },
      { key: 'Work', value: work || 'See design notes' },
      { key: 'Length', value: lengthVal || 'As per standard piece' },
      { key: 'Blouse', value: 'Unstitched blouse piece included unless noted' },
      { key: 'Care', value: 'Dry clean recommended' },
    ];
    for (const d of defaults) {
      if (!rows.some((r) => r.key.toLowerCase() === d.key.toLowerCase())) {
        rows.push(d);
      }
    }
  }

  const serialized = serializeDetailRows(rows);
  productDetailKeys = serialized.keys;
  productDetailValues = serialized.values;

  if (!tags.length && input.name) {
    const base = input.name
      .toLowerCase()
      .split(/\s+/)
      .filter((w) => w.length > 2)
      .slice(0, 4);
    if (input.category) base.push(input.category.toLowerCase());
    tags = [...new Set(base)].slice(0, 8);
  }

  return {
    shortDescription: shortDescription.slice(0, 220),
    description: description.slice(0, 4000),
    seoTitle: seoTitle.slice(0, 70),
    seoDescription: seoDescription.slice(0, 170),
    tags,
    productDetailKeys,
    productDetailValues,
  };
}
