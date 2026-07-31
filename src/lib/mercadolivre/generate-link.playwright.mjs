// Roda DENTRO da Vercel Sandbox (node generate-link.mjs <link-produto>).
// Usa a sessão salva em /vercel/sandbox/session.json (storageState do Playwright).
//
// Faz três coisas na mesma sessão de browser:
//   0. Navega até o link recebido e segue qualquer redirect (HTTP normal ou
//      client-side via JS — comum em encurtador/rastreador de terceiro tipo
//      go.promozone.ai) até o destino final, e só então confere se caiu
//      mesmo numa página do Mercado Livre ou da Shopee. A partir daqui usa a
//      URL resolvida (page.url()), não o link original recebido.
//   1. Extrai título/preço/imagem do HTML da página do produto.
//      (a API pública api.mercadolibre.com/items/{id} passou a exigir OAuth
//      e não serve mais pra isso — descoberto em validação manual real.)
//   2. Gera o link de afiliado:
//      - Mercado Livre: visita o gerador de link de afiliado
//        (mercadolivre.com.br/afiliados/linkbuilder#hub, só acessível pra
//        conta já aprovada no Programa de Afiliados) e gera o link.
//      - Shopee: chama a API oficial de afiliados (GraphQL, assinada com
//        SHA256) via fetch, sem precisar de um segundo browser.
//
// Imprime em stdout um JSON: {"title","price","imageUrl","marketplace","affiliateLink"}.
//
// O Mercado Livre bloqueia Chromium headless "puro" com uma página de erro
// genérica ("Hubo un error accediendo a esta pagina..."), mesmo com sessão
// válida — por isso o context abaixo usa user-agent real, esconde
// navigator.webdriver e passa --disable-blink-features=AutomationControlled.
// Sem isso, TODA navegação falha, não só a do link builder.
//
// --no-sandbox e --disable-setuid-sandbox são necessários porque o usuário
// vercel-sandbox não tem privilégio de kernel pro sandbox interno do próprio
// Chromium; sem essas flags o browser fecha sozinho logo após abrir
// ("Target page, context or browser has been closed").

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright';

// Assinatura exigida pela Shopee Affiliate Open API: header
// `Authorization: SHA256 Credential={appId}, Timestamp={timestamp}, Signature={signature}`,
// onde signature = SHA256(appId + timestamp + payload + secret) em hex,
// timestamp em segundos Unix. Extraída como função pura pra ser testável
// isoladamente (ver generate-link.playwright.test.ts) sem precisar rodar o
// resto do script (que depende de Playwright + sessão real).
export function calculateShopeeSignature(appId, timestamp, payload, secret) {
  return createHash('sha256')
    .update(`${appId}${timestamp}${payload}${secret}`)
    .digest('hex');
}

async function main() {
  const [, , productLink] = process.argv;

  if (!productLink) {
    console.error('Uso: node generate-link.mjs <link-produto>');
    process.exit(1);
  }

  const storageState = JSON.parse(readFileSync('/vercel/sandbox/session.json', 'utf8'));

  const browser = await chromium.launch({
    args: [
      '--disable-blink-features=AutomationControlled',
      '--no-sandbox',
      '--disable-setuid-sandbox',
    ],
  });
  const context = await browser.newContext({
    storageState,
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    viewport: { width: 1280, height: 900 },
    locale: 'pt-BR',
  });
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  });
  const page = await context.newPage();

  try {
    // 0. Resolve redirect (HTTP ou client-side) e confere destino final
    await page.goto(productLink, { waitUntil: 'networkidle', timeout: 45000 }).catch(() => {});
    await page.waitForTimeout(1500);

    let resolvedUrl = page.url();
    let resolvedHost;
    try {
      resolvedHost = new URL(resolvedUrl).hostname;
    } catch {
      resolvedHost = '';
    }
    const isMercadoLivre =
      /(^|\.)mercadolivre\.com\.br$/i.test(resolvedHost) || /(^|\.)mercadolibre\.com$/i.test(resolvedHost);
    const isShopee = /(^|\.)shopee\.com\.br$/i.test(resolvedHost);

    if (!isMercadoLivre && !isShopee) {
      console.error(`MARKETPLACE_NOT_SUPPORTED (resolvido para: ${resolvedUrl})`);
      process.exit(1);
    }

    if (isMercadoLivre) {
      // 0.5. Encurtadores de terceiro (ex: go.promozone.ai) às vezes caem numa
      // página de "Perfil Social" do afiliado no Mercado Livre em vez de ir
      // direto pro produto — essa página tem um botão "Ir para produto" que
      // leva pra ficha real (descoberto em validação manual real, 2026-07-29).
      // Se existir, segue esse link antes de tentar extrair título/preço.
      const irParaProdutoLink = page.getByRole('link', { name: /ir para produto/i }).first();
      const productHref = await irParaProdutoLink.getAttribute('href', { timeout: 5000 }).catch(() => null);
      if (productHref) {
        await page.goto(productHref, { waitUntil: 'networkidle', timeout: 45000 }).catch(() => {});
        await page.waitForTimeout(1500);
        resolvedUrl = page.url();
      }

      // 0.6. Cupons de loja/categoria inteira (sem produto único vinculado) às
      // vezes vêm com um link genérico pro índice de listas curadas do afiliado
      // (ex: /social/promozonevip/lists) em vez de um produto — essa página não
      // tem título/preço/imagem de produto pra extrair (confirmado em validação
      // manual real, 2026-07-31). Detecta esse formato antes de tentar extrair
      // e reporta um motivo específico, em vez de cair no PRODUCT_NOT_FOUND
      // genérico (que soa como falha inesperada, quando na verdade é esperado).
      if (/\/social\/[^/]+\/lists\/?$/i.test(new URL(resolvedUrl).pathname)) {
        console.error(`PRODUCT_LIST_LINK (resolvido para: ${resolvedUrl})`);
        process.exit(1);
      }
    }

    // 1. Dados do produto (já estamos na página, resolvida acima) — mesmo
    // padrão de meta tags pros dois marketplaces (Open Graph + itemprop).
    const title = await page.locator('h1').first().innerText({ timeout: 15000 }).catch(() => null);

    const priceMeta = await page
      .locator('meta[itemprop="price"], meta[property="product:price:amount"]')
      .first()
      .getAttribute('content')
      .catch(() => null);
    const price = priceMeta ? Number.parseFloat(priceMeta) : NaN;

    const imageUrl = await page
      .locator('meta[property="og:image"]')
      .first()
      .getAttribute('content')
      .catch(() => null);

    if (!title || Number.isNaN(price) || !imageUrl) {
      console.error(
        `PRODUCT_NOT_FOUND (title=${JSON.stringify(title)}, price=${priceMeta}, imageUrl=${JSON.stringify(imageUrl)})`,
      );
      process.exit(1);
    }

    if (isShopee) {
      // 2 (Shopee). Gera o link de afiliado via API oficial (GraphQL,
      // assinada com SHA256) — não precisa de um segundo browser nem de
      // sessão logada, só das credenciais fixas do app de afiliado.
      const appId = process.env.SHOPEE_APP_ID;
      const secretKey = process.env.SHOPEE_SECRET_KEY;
      if (!appId || !secretKey) {
        console.error('SHOPEE_CREDENTIALS_MISSING');
        process.exit(1);
      }

      const timestamp = Math.floor(Date.now() / 1000);
      const query =
        'mutation generateShortLink($input: ShortLinkInput!) { generateShortLink(input: $input) { shortLink } }';
      const variables = { input: { originUrl: resolvedUrl, subIds: ['promopost'] } };
      const payload = JSON.stringify({ query, variables });
      const signature = calculateShopeeSignature(appId, timestamp, payload, secretKey);

      const shopeeRes = await fetch('https://open-api.affiliate.shopee.com.br/graphql', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `SHA256 Credential=${appId}, Timestamp=${timestamp}, Signature=${signature}`,
        },
        body: payload,
      });
      const shopeeJson = await shopeeRes.json().catch(() => null);
      const affiliateLink = shopeeJson?.data?.generateShortLink?.shortLink;

      if (!shopeeRes.ok || shopeeJson?.errors || !affiliateLink) {
        console.error(`SHOPEE_API_ERROR (${JSON.stringify(shopeeJson?.errors ?? shopeeRes.status)})`);
        process.exit(1);
      }

      console.log(JSON.stringify({ title, price, imageUrl, marketplace: 'shopee', affiliateLink }));
      return;
    }

    // 2 (Mercado Livre). Visita o gerador de link de afiliado (só acessível
    // pra conta já aprovada no Programa de Afiliados) e gera o link.
    await page.goto('https://www.mercadolivre.com.br/afiliados/linkbuilder#hub', {
      waitUntil: 'domcontentloaded',
      timeout: 45000,
    });

    const urlField = page.locator('#url-0');
    const formVisible = await urlField.isVisible({ timeout: 15000 }).catch(() => false);

    if (!formVisible) {
      console.error('SESSION_EXPIRED');
      process.exit(1);
    }

    // A SPA religa os handlers reativos (que habilitam o botão "Gerar") um
    // pouco depois do campo ficar visível — preencher rápido demais faz o
    // valor entrar no DOM mas o estado do React não é atualizado, e o botão
    // fica preso em disabled. Dá um tempo de acomodação antes de preencher.
    await page.waitForTimeout(2500);
    await urlField.fill(resolvedUrl);
    await page.waitForTimeout(500);

    const gerarBtn = page.getByRole('button', { name: 'Gerar' });
    const stillDisabled = await gerarBtn.evaluate((el) => el.hasAttribute('disabled')).catch(() => true);
    if (stillDisabled) {
      // Fallback: repete o preenchimento caso o primeiro tenha corrido antes
      // da hidratação religar o handler.
      await urlField.fill('');
      await urlField.fill(resolvedUrl);
      await page.waitForTimeout(1500);
    }

    await gerarBtn.click({ timeout: 30000 });

    const affiliateLink = await page.locator('#textfield-copyLink-1').inputValue({ timeout: 15000 });

    if (!affiliateLink || !affiliateLink.startsWith('http')) {
      throw new Error(`Campo de resultado sem link válido: "${affiliateLink}"`);
    }

    console.log(
      JSON.stringify({ title, price, imageUrl, marketplace: 'mercadolivre', affiliateLink: affiliateLink.trim() }),
    );
  } catch (err) {
    console.error(String(err));
    process.exit(1);
  } finally {
    await browser.close();
  }
}

if (import.meta.filename === process.argv[1]) {
  await main();
}
