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
  // "MLB<dígitos>" é item/catálogo comum; "MLBU<dígitos>" é produto usado
  // (path /up/), formato descoberto testando link real do site.
  const match = link.match(/MLB(U)?-?(\d{6,})/i);
  if (!match) {
    return null;
  }
  return `MLB${match[1] ? 'U' : ''}${match[2]}`;
}
