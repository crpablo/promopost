import { createHash } from 'node:crypto';

export function isShopeeLink(link: string): boolean {
  try {
    const url = new URL(link);
    if (/(^|\.)shopee\.com\.br$/i.test(url.hostname)) {
      return true;
    }
    // O canal do Telegram passou a mandar cupons da Shopee encurtados pelo
    // encurtador próprio do canal (go.promozone.ai/shopee/<codigo>) em vez
    // do encurtador oficial da Shopee (s.shopee.com.br) — sem esse caso,
    // esses links caíam no fallback genérico via Playwright (o mesmo do
    // Mercado Livre/Amazon), que ao seguir o redirect esbarra no bot-check
    // da Shopee (só dispara em navegação de browser de verdade, não no
    // fetch simples usado por buildShopeeAffiliateLink) em vez de usar a
    // API oficial. go.promozone.ai encurta pra outros marketplaces também
    // (ex: /mercadolivre/, /magalu/, /amz/) usando o mesmo domínio, então o
    // prefixo do path é o único jeito de saber que ESSE link é da Shopee
    // sem precisar seguir o redirect (o que gera outro request de rede).
    return /(^|\.)go\.promozone\.ai$/i.test(url.hostname) && /^\/shopee\//i.test(url.pathname);
  } catch {
    return false;
  }
}

// Assinatura exigida pela Shopee Affiliate Open API: header
// `Authorization: SHA256 Credential={appId}, Timestamp={timestamp}, Signature={signature}`,
// onde signature = SHA256(appId + timestamp + payload + secret) em hex,
// timestamp em segundos Unix. Migrada de generate-link.playwright.mjs
// (função pura, extraída de lá pra cá — ver limpeza do branch morto da
// Shopee no script Playwright).
export function calculateShopeeSignature(
  appId: string,
  timestamp: number,
  payload: string,
  secret: string,
): string {
  return createHash('sha256')
    .update(`${appId}${timestamp}${payload}${secret}`)
    .digest('hex');
}

// Resolve o link curto da Shopee (s.shopee.com.br/xxx, formato sempre usado
// nas mensagens do canal) pra URL canônica do produto, e gera o link de
// afiliado via API oficial (GraphQL, assinada com SHA256). A resolução do
// link curto é um redirect HTTP simples (confirmado via curl -sIL, 301, sem
// disparar o bot-check de JS da Shopee — esse só age em navegação de browser
// de verdade) — por isso um fetch simples com redirect:'follow' basta, sem
// precisar de Playwright.
export async function buildShopeeAffiliateLink(
  productLink: string,
  appId: string,
  secretKey: string,
): Promise<string> {
  let resolvedUrl: string;
  try {
    const redirectRes = await fetch(productLink, { redirect: 'follow' });
    resolvedUrl = redirectRes.url;
  } catch (err) {
    throw new Error(`SHOPEE_REDIRECT_ERROR (${String(err)})`);
  }

  const timestamp = Math.floor(Date.now() / 1000);
  const query =
    'mutation generateShortLink($input: ShortLinkInput!) { generateShortLink(input: $input) { shortLink } }';
  const variables = { input: { originUrl: resolvedUrl, subIds: ['promopost'] } };
  const payload = JSON.stringify({ query, variables });
  const signature = calculateShopeeSignature(appId, timestamp, payload, secretKey);

  let shopeeRes;
  let shopeeJson;
  try {
    shopeeRes = await fetch('https://open-api.affiliate.shopee.com.br/graphql', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `SHA256 Credential=${appId}, Timestamp=${timestamp}, Signature=${signature}`,
      },
      body: payload,
      signal: AbortSignal.timeout(15000),
    });
    shopeeJson = await shopeeRes.json().catch(() => null);
  } catch (err) {
    throw new Error(`SHOPEE_API_ERROR (${String(err)})`);
  }

  const affiliateLink = shopeeJson?.data?.generateShortLink?.shortLink;
  if (!shopeeRes.ok || shopeeJson?.errors || !affiliateLink) {
    throw new Error(`SHOPEE_API_ERROR (${JSON.stringify(shopeeJson?.errors ?? shopeeRes.status)})`);
  }

  return affiliateLink;
}
