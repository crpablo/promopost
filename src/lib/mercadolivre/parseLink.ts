// Só valida que `link` é uma URL http(s) sintaticamente válida — um gate
// barato pra rejeitar lixo óbvio (string vazia, não-URL) sem gastar sandbox.
//
// Não valida mais domínio nem extrai ID aqui: o link recebido pode ser um
// encurtador/rastreador de terceiro (ex: go.promozone.ai, bit.ly) que só
// revela o destino real do Mercado Livre depois de seguir redirect — e
// redirect client-side (via JS) só resolve com um browser de verdade.
// Essa resolução + validação de domínio ML acontece dentro do script que
// roda na sandbox (generate-link.playwright.mjs), depois de navegar até
// o link e conferir onde ele realmente caiu.
export function parseItemId(link: string): string | null {
  let url: URL;
  try {
    url = new URL(link);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return null;
  }
  return link;
}
