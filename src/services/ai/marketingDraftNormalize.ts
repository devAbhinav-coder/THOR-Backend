import { parseJsonFromModel } from './groqClient';

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function unescapeJsonString(s: string): string {
  return s
    .replace(/\\n/g, '\n')
    .replace(/\\t/g, '\t')
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, '\\');
}

function plainToMessageHtml(text: string): string {
  const t = text.trim();
  if (!t) return '';
  if (/<(?:p|div|br|strong|em|ul|ol|li)\b/i.test(t)) return t;
  const paras = t.split(/\n\n+/).map((p) => p.trim()).filter(Boolean);
  if (paras.length === 0) return `<p>${escapeHtml(t)}</p>`;
  return paras.map((p) => `<p>${escapeHtml(p.replace(/\n/g, ' '))}</p>`).join('');
}

function regexExtractFields(raw: string): { subject?: string; messageHtml?: string } {
  const subjectM = raw.match(/"subject"\s*:\s*"((?:\\.|[^"\\])*)"/i);
  const htmlM = raw.match(/"messageHtml"\s*:\s*"((?:\\.|[^"\\])*)"/is);
  return {
    subject: subjectM ? unescapeJsonString(subjectM[1]) : undefined,
    messageHtml: htmlM ? unescapeJsonString(htmlM[1]) : undefined,
  };
}

export function normalizeMarketingEmailDraft(
  raw: string,
  opts?: { subjectHint?: string },
): { subject: string; messageHtml: string } {
  const parsed = parseJsonFromModel<Record<string, unknown>>(raw);
  const regex = regexExtractFields(raw);
  const p = parsed || {};

  let subject = String(p.subject || p.Subject || p.title || regex.subject || '').trim();
  let messageHtml = String(
    p.messageHtml ||
      p.message_html ||
      p.html ||
      p.body ||
      p.content ||
      regex.messageHtml ||
      '',
  ).trim();

  if (!messageHtml && p.message) messageHtml = plainToMessageHtml(String(p.message));
  if (!messageHtml && p.text && String(p.text) !== subject) {
    messageHtml = plainToMessageHtml(String(p.text));
  }

  if (!messageHtml && raw.trim() && !raw.trim().startsWith('{')) {
    messageHtml = plainToMessageHtml(raw);
  }

  if (!subject && opts?.subjectHint) subject = opts.subjectHint.trim();
  if (!subject && messageHtml) {
    const plain = messageHtml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    subject = plain.slice(0, 70);
  }
  if (!subject) subject = 'News from The House of Rani';

  if (messageHtml && !/<[a-z]/i.test(messageHtml)) {
    messageHtml = plainToMessageHtml(messageHtml);
  }

  return {
    subject: subject.slice(0, 120),
    messageHtml: messageHtml.slice(0, 6000),
  };
}
