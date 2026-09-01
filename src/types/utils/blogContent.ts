import sanitizeHtml from 'sanitize-html';

const BLOG_HTML_OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: [
    'p',
    'h1',
    'h2',
    'h3',
    'ul',
    'ol',
    'li',
    'strong',
    'em',
    'u',
    'a',
    'br',
    'hr',
    'blockquote',
    'figure',
    'figcaption',
    'span',
  ],
  allowedAttributes: {
    a: ['href', 'title', 'target', 'rel'],
    blockquote: ['class'],
    figure: ['class'],
    figcaption: ['class'],
    p: ['class', 'style'],
    h1: ['style'],
    h2: ['style'],
    h3: ['style'],
    span: ['style'],
  },
  allowedStyles: {
    '*': {
      'font-family': [/^[\w\s,"'-]+$/],
      'text-align': [/^(left|center|right|justify)$/],
      'font-size': [/^\d+(\.\d+)?(px|em|rem|%)$/],
      color: [/^#[0-9a-f]{3,8}$/i, /^rgb\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*\)$/i, /^rgba\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*,\s*[\d.]+\s*\)$/i],
    },
  },
  allowedSchemes: ['http', 'https', 'mailto'],
  transformTags: {
    a: sanitizeHtml.simpleTransform('a', {
      rel: 'noopener noreferrer',
      target: '_blank',
    }),
  },
};

export function plainBlogText(content: string): string {
  return sanitizeHtml(String(content || ''), { allowedTags: [], allowedAttributes: {} })
    .replace(/\s+/g, ' ')
    .trim();
}

export function plainBlogExcerpt(content: string, max = 200): string {
  return plainBlogText(content).slice(0, max);
}

export function sanitizeBlogHtml(content: string): string {
  return sanitizeHtml(String(content || ''), BLOG_HTML_OPTIONS).trim();
}

/** Normalize AI/plain HTML without inventing blockquotes. */
export function enrichBlogContentHtml(content: string): string {
  let html = sanitizeBlogHtml(content);
  html = html.replace(/<p>\s*<\/p>/gi, '');
  html = html.replace(/(<br\s*\/?>\s*){3,}/gi, '<br /><br />');
  return html.trim();
}

export function computeReadingTimeMin(content: string): number {
  const words = plainBlogText(content).split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.ceil(words / 200));
}

export function slugFromTitle(title: string): string {
  return String(title || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)+/g, '')
    .slice(0, 120);
}

export const BLOG_CATEGORIES = [
  'saree-styling',
  'bridal',
  'gifting',
  'fabric-care',
  'festive',
  'trends',
] as const;

export type BlogCategory = (typeof BLOG_CATEGORIES)[number];
