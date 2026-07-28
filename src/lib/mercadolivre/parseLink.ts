export function parseItemId(link: string): string | null {
  let host: string;
  try {
    host = new URL(link).hostname;
  } catch {
    return null;
  }
  if (!/(^|\.)mercadolivre\.com\.br$/i.test(host) && !/(^|\.)mercadolibre\.com$/i.test(host)) {
    return null;
  }
  const match = link.match(/MLB-?(\d{6,})/i);
  if (!match) {
    return null;
  }
  return `MLB${match[1]}`;
}
