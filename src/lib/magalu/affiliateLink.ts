export function isMagaluLink(link: string): boolean {
  try {
    return /(^|\.)magazineluiza\.com\.br$/i.test(new URL(link).hostname);
  } catch {
    return false;
  }
}

// Gera o link de afiliado do Magalu sem nenhuma chamada de rede — sobrescreve
// (ou adiciona, se ainda não existirem) os parâmetros partner_id, promoter_id
// e utm_source/utm_medium/utm_campaign na própria URL resolvida do produto.
// O link que já circula no canal de origem tem esse mesmo formato, só que
// com os valores do afiliado que postou — aqui trocamos pelos nossos, pra
// garantir que o crédito da venda vá pra nossa conta, nunca a de quem
// postou originalmente (confirmado com o usuário, 2026-08-04).
export function buildMagaluAffiliateLink(url: string, partnerId: string, promoterId: string): string {
  const parsed = new URL(url);
  parsed.searchParams.set('partner_id', partnerId);
  parsed.searchParams.set('promoter_id', promoterId);
  parsed.searchParams.set('utm_source', 'divulgador');
  parsed.searchParams.set('utm_medium', 'magalu');
  parsed.searchParams.set('utm_campaign', promoterId);
  return parsed.toString();
}
