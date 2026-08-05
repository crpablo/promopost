import { createHash } from 'node:crypto';

export function isShopeeLink(link: string): boolean {
  try {
    return /(^|\.)shopee\.com\.br$/i.test(new URL(link).hostname);
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
