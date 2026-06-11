/** Local feature-hashing embeddings — no Pinecone / external API required. */

const DIM = 256;

function tokenize(text: string): string[] {
  return String(text || "")
    .toLowerCase()
    .replace(/<[^>]+>/g, " ")
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 2);
}

function hashToken(token: string, dim: number): number {
  let h = 2166136261;
  for (let i = 0; i < token.length; i++) {
    h ^= token.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h) % dim;
}

export function embedText(text: string, dim = DIM): number[] {
  const vec = new Array(dim).fill(0);
  const tokens = tokenize(text);
  if (tokens.length === 0) return vec;

  for (const token of tokens) {
    const idx = hashToken(token, dim);
    const sign = hashToken(`${token}:sign`, dim) % 2 === 0 ? 1 : -1;
    vec[idx] += sign;
    // bigrams
    if (token.length > 4) {
      const bi = hashToken(token.slice(0, 4), dim);
      vec[bi] += sign * 0.5;
    }
  }

  const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0)) || 1;
  return vec.map((v) => v / norm);
}

export function cosineSimilarity(a: number[], b: number[]): number {
  const len = Math.min(a.length, b.length);
  let dot = 0;
  for (let i = 0; i < len; i++) dot += (a[i] || 0) * (b[i] || 0);
  return dot;
}

export function blogEmbedSource(parts: {
  title?: string;
  excerpt?: string;
  content?: string;
  keywords?: string[];
  tags?: string[];
  category?: string;
}): string {
  return [
    parts.title,
    parts.excerpt,
    parts.category,
    (parts.keywords || []).join(" "),
    (parts.tags || []).join(" "),
    String(parts.content || "")
      .replace(/<[^>]+>/g, " ")
      .slice(0, 4000),
  ]
    .filter(Boolean)
    .join("\n");
}

export function productEmbedSource(parts: {
  name?: string;
  shortDescription?: string;
  category?: string;
  fabric?: string;
  tags?: string[];
}): string {
  return [
    parts.name,
    parts.category,
    parts.fabric,
    (parts.tags || []).join(" "),
    parts.shortDescription,
  ]
    .filter(Boolean)
    .join("\n");
}
