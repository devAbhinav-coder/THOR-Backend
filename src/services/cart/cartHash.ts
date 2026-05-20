import crypto from 'crypto';

export function generateCustomizationHash(
  answers?: { label: string; value: string }[] | string
): string {
  if (!answers) return '';
  const parsed =
    typeof answers === 'string'
      ? (JSON.parse(answers) as { label: string; value: string }[])
      : answers;
  if (!parsed?.length) return '';

  const serialized = parsed
    .slice()
    .sort((a, b) => a.label.localeCompare(b.label))
    .map((a) => `${a.label}=${String(a.value).trim()}`)
    .join('|');

  return crypto.createHash('md5').update(serialized).digest('hex');
}

export function generateCartItemId(sku: string, hash: string): string {
  return crypto.createHash('md5').update(`${sku}:${hash}`).digest('hex');
}
