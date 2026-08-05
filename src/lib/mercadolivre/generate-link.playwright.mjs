// Roda como processo filho local da aplicação (node generate-link.mjs <link-produto>).
// Usa a sessão salva no caminho apontado por ML_SESSION_PATH (storageState do Playwright).
//
// Faz três coisas na mesma sessão de browser:
//   0. Navega até o link recebido e segue qualquer redirect (HTTP normal ou
//      client-side via JS — comum em encurtador/rastreador de terceiro tipo
//      go.promozone.ai) até o destino final, e só então confere se caiu
//      mesmo numa página do Mercado Livre. A partir daqui usa a URL
//      resolvida (page.url()), não o link original recebido.
//   1. Extrai título/preço/imagem do HTML da página do produto.
//      (a API pública api.mercadolibre.com/items/{id} passou a exigir OAuth
//      e não serve mais pra isso — descoberto em validação manual real.)
//   2. Gera o link de afiliado: visita o gerador de link de afiliado
//      (mercadolivre.com.br/afiliados/linkbuilder#hub, só acessível pra
//      conta já aprovada no Programa de Afiliados) e gera o link.
//
// Imprime em stdout um JSON: {"title","price","imageUrl","marketplace","affiliateLink"}.
//
// O Mercado Livre bloqueia Chromium headless "puro" com uma página de erro
// genérica ("Hubo un error accediendo a esta pagina..."), mesmo com sessão
// válida — por isso o context abaixo usa user-agent real, esconde
// navigator.webdriver e passa --disable-blink-features=AutomationControlled.
// Sem isso, TODA navegação falha, não só a do link builder.
//
// --no-sandbox e --disable-setuid-sandbox continuam necessários mesmo fora da
// Vercel Sandbox: sem privilégio de kernel pro sandbox interno do próprio
// Chromium (comum em containers Docker), o browser fecha sozinho logo após
// abrir ("Target page, context or browser has been closed").

import { readFileSync } from 'node:fs';
import { chromium } from 'playwright';

// Converte o texto formatado do preço da Amazon (ex: "R$ 1.234,56", com
// separador de milhar "." e decimal ",") pra número. Remove tudo que não
// for dígito/vírgula/ponto/sinal, remove pontos de milhar, troca vírgula
// decimal por ponto. Retorna NaN se não sobrar nada numérico (inclui o
// caso de `text` ser null).
export function parseBrazilianPrice(text) {
  if (!text) return NaN;
  const cleaned = text.replace(/[^\d,.-]/g, '').replace(/\./g, '').replace(',', '.');
  return Number.parseFloat(cleaned);
}

// Gera o link de afiliado da Amazon sem nenhuma chamada de rede — só
// adiciona (ou sobrescreve, se já existir) o parâmetro `tag` na própria
// URL resolvida do produto. Extraída como função pura pra ser testável
// isoladamente (ver generate-link.playwright.test.ts).
export function buildAmazonAffiliateLink(url, tag) {
  const parsed = new URL(url);
  parsed.searchParams.set('tag', tag);
  return parsed.toString();
}

// Visita o gerador de link de afiliado do Mercado Livre (só acessível pra
// conta já aprovada no Programa de Afiliados) e gera um link de afiliado
// pra qualquer URL do domínio deles — não é restrito a página de produto,
// funciona igual pra página de lista de cupom (confirmado em validação
// manual real, 2026-08-04). Reaproveitado tanto pro fluxo normal de
// produto quanto pro fluxo de cupom de lista.
async function generateMlAffiliateLink(page, url) {
  await page.goto('https://www.mercadolivre.com.br/afiliados/linkbuilder#hub', {
    waitUntil: 'domcontentloaded',
    timeout: 45000,
  });

  const urlField = page.locator('#url-0');
  const formVisible = await urlField.isVisible({ timeout: 15000 }).catch(() => false);

  if (!formVisible) {
    throw new Error('SESSION_EXPIRED');
  }

  // A SPA religa os handlers reativos (que habilitam o botão "Gerar") um
  // pouco depois do campo ficar visível — preencher rápido demais faz o
  // valor entrar no DOM mas o estado do React não é atualizado, e o botão
  // fica preso em disabled. Dá um tempo de acomodação antes de preencher.
  await page.waitForTimeout(2500);
  await urlField.fill(url);
  await page.waitForTimeout(500);

  const gerarBtn = page.getByRole('button', { name: 'Gerar' });
  const stillDisabled = await gerarBtn.evaluate((el) => el.hasAttribute('disabled')).catch(() => true);
  if (stillDisabled) {
    // Fallback: repete o preenchimento caso o primeiro tenha corrido antes
    // da hidratação religar o handler.
    await urlField.fill('');
    await urlField.fill(url);
    await page.waitForTimeout(1500);
  }

  await gerarBtn.click({ timeout: 30000 });

  const affiliateLink = await page.locator('#textfield-copyLink-1').inputValue({ timeout: 15000 });

  if (!affiliateLink || !affiliateLink.startsWith('http')) {
    throw new Error(`Campo de resultado sem link válido: "${affiliateLink}"`);
  }

  return affiliateLink.trim();
}

async function main() {
  const [, , productLink] = process.argv;

  if (!productLink) {
    console.error('Uso: node generate-link.mjs <link-produto>');
    process.exit(1);
  }

  const storageState = JSON.parse(readFileSync(process.env.ML_SESSION_PATH, 'utf8'));

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

  let exitCode = 0;
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
    const isAmazon = /(^|\.)amazon\.com\.br$/i.test(resolvedHost);

    // Checa a credencial da Amazon assim que sabemos que é Amazon (o
    // Associate Tag não é secreto, mas sem ele o link gerado não dá
    // comissão nenhuma pro afiliado — falha explícita é melhor que gerar
    // um link "funcional" só que sem crédito).
    let amazonTag;
    if (isAmazon) {
      amazonTag = process.env.AMAZON_ASSOCIATE_TAG;
      if (!amazonTag) {
        throw new Error('AMAZON_CREDENTIALS_MISSING');
      }
    }

    if (!isMercadoLivre && !isAmazon) {
      throw new Error(`MARKETPLACE_NOT_SUPPORTED (resolvido para: ${resolvedUrl})`);
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

      // Cupons de loja/categoria inteira (sem produto único vinculado) às
      // vezes vêm com um link genérico pro índice de listas curadas do
      // afiliado (ex: /social/promozonevip/lists) em vez de um produto —
      // essa página não tem título/preço/imagem de produto pra extrair
      // (confirmado em validação manual real, 2026-07-31). Em vez de
      // descartar (comportamento antigo), gera nosso próprio link de
      // afiliado pra essa mesma página de lista — o gerador de link aceita
      // qualquer URL do domínio, não só produto (confirmado em validação
      // manual real, 2026-08-04).
      if (/\/social\/[^/]+\/lists\/?$/i.test(new URL(resolvedUrl).pathname)) {
        // Remove query string/hash antes de gerar o link — a URL resolvida
        // pode ainda carregar parâmetros de rastreamento do afiliado
        // original (ex: matt_word, matt_tool) herdados da cadeia de
        // redirecionamento, e não queremos que esses parâmetros sobrevivam
        // pro link que geramos (o objetivo inteiro desse fluxo é criar um
        // link que credita a NOSSA conta, nunca a do afiliado original).
        const listUrl = new URL(resolvedUrl);
        const cleanListUrl = `${listUrl.origin}${listUrl.pathname}`;
        const affiliateLink = await generateMlAffiliateLink(page, cleanListUrl);
        console.log(JSON.stringify({ marketplace: 'mercadolivre', affiliateLink, isListCoupon: true }));
        return;
      }
    }

    if (isAmazon) {
      // 0.7. A Amazon costuma interpor uma página de confirmação "Continuar
      // comprando" (bot-check simples) na primeira navegação de uma sessão
      // de browser nova — mesmo em acesso direto à URL do produto, sem
      // encurtador envolvido (confirmado em validação manual real,
      // 2026-08-03). Clicar no botão não leva pro produto (redireciona pra
      // home), mas deixa um cookie de sessão que libera a navegação
      // seguinte — então clica e re-navega pra mesma URL resolvida antes de
      // tentar extrair título/preço.
      const continuarComprandoBtn = page.getByRole('button', { name: /continuar comprando/i }).first();
      const hasInterstitial = await continuarComprandoBtn.count().catch(() => 0);
      if (hasInterstitial) {
        await continuarComprandoBtn.click({ timeout: 5000 }).catch(() => {});
        await page.waitForTimeout(1500);
        await page.goto(resolvedUrl, { waitUntil: 'networkidle', timeout: 45000 }).catch(() => {});
        await page.waitForTimeout(1500);
      }
    }

    // 1. Dados do produto (já estamos na página, resolvida acima) — mesmo
    // padrão de meta tags pros marketplaces, com seletor específico da
    // Amazon pro preço (ver parseBrazilianPrice, no topo do arquivo).
    let title = null;
    if (isAmazon) {
      // A página de produto da Amazon tem vários elementos <h1> (incluindo
      // texto de acessibilidade tipo "resumo do produto... atalho do
      // teclado" antes do título real) — pegar o primeiro h1 pega o texto
      // errado. O título fica de forma confiável em #productTitle
      // (confirmado em validação manual real, 2026-08-03).
      title = await page.locator('#productTitle').first().innerText({ timeout: 10000 }).catch(() => null);
    }
    if (!title) {
      title = await page.locator('h1').first().innerText({ timeout: 15000 }).catch(() => null);
    }
    if (!title && isAmazon) {
      // Páginas de produto da Amazon frequentemente não expõem o nome do
      // produto de forma confiável só via h1 — cai pro og:title, mesmo
      // padrão de .getAttribute já usado abaixo pra imageUrl/preço.
      // Restrito à Amazon pra não mudar o comportamento do Mercado Livre
      // (que já funciona com h1) — uma página de erro/interstitial do ML
      // sem h1 mas com og:title continuaria corretamente caindo em
      // PRODUCT_NOT_FOUND.
      title = await page
        .locator('meta[property="og:title"]')
        .first()
        .getAttribute('content')
        .catch(() => null);
    }

    let priceRaw = null;
    let price = NaN;
    if (isAmazon) {
      // A Amazon não expõe meta tag de preço confiável — o valor formatado
      // fica num elemento visual/acessível (".a-price .a-offscreen"), ex:
      // "R$ 1.234,56". A página tem vários desses elementos (preço de
      // outras ofertas/variações, elementos de template vazios) — o
      // primeiro `.a-price .a-offscreen` da página às vezes vem vazio
      // (confirmado em validação manual real, 2026-08-03), então prioriza
      // o escopado dentro de #corePrice_feature_div (o preço "oficial" da
      // buybox) antes do seletor genérico.
      priceRaw = await page
        .locator('#corePrice_feature_div .a-offscreen')
        .first()
        .innerText({ timeout: 10000 })
        .catch(() => null);
      if (!priceRaw) {
        priceRaw = await page
          .locator('.a-price .a-offscreen')
          .first()
          .innerText({ timeout: 10000 })
          .catch(() => null);
      }
      price = parseBrazilianPrice(priceRaw);
    }
    if (Number.isNaN(price)) {
      // Fallback pra mesma meta tag do Mercado Livre — sempre usada por ele,
      // e pela Amazon só se o seletor acima não achar nada (layout
      // diferente, produto sem preço visível, etc).
      priceRaw = await page
        .locator('meta[itemprop="price"], meta[property="product:price:amount"]')
        .first()
        .getAttribute('content')
        .catch(() => null);
      price = priceRaw ? Number.parseFloat(priceRaw) : NaN;
    }

    let imageUrl = null;
    if (isAmazon) {
      // A Amazon não expõe og:image de forma confiável — a imagem
      // principal do produto fica no elemento #landingImage.
      // data-old-hires traz a versão em resolução mais alta; src é o
      // fallback (resolução menor, mas sempre presente quando a imagem
      // carrega) (confirmado em validação manual real, 2026-08-03).
      imageUrl = await page.locator('#landingImage').first().getAttribute('data-old-hires').catch(() => null);
      if (!imageUrl) {
        imageUrl = await page.locator('#landingImage').first().getAttribute('src').catch(() => null);
      }
    }
    if (!imageUrl) {
      imageUrl = await page
        .locator('meta[property="og:image"]')
        .first()
        .getAttribute('content')
        .catch(() => null);
    }

    if (!title || Number.isNaN(price) || !imageUrl) {
      throw new Error(
        `PRODUCT_NOT_FOUND (title=${JSON.stringify(title)}, price=${priceRaw}, imageUrl=${JSON.stringify(imageUrl)})`,
      );
    }

    if (isAmazon) {
      // 2 (Amazon). Sem API, sem sessão — só garante o parâmetro de
      // afiliado na própria URL resolvida do produto.
      const affiliateLink = buildAmazonAffiliateLink(resolvedUrl, amazonTag);
      console.log(JSON.stringify({ title, price, imageUrl, marketplace: 'amazon', affiliateLink }));
      return;
    }

    // 2 (Mercado Livre). Gera o link de afiliado pra URL do produto.
    const affiliateLink = await generateMlAffiliateLink(page, resolvedUrl);
    console.log(JSON.stringify({ title, price, imageUrl, marketplace: 'mercadolivre', affiliateLink }));
  } catch (err) {
    console.error(String(err));
    exitCode = 1;
  } finally {
    await browser.close();
  }

  if (exitCode !== 0) {
    process.exit(exitCode);
  }
}

if (import.meta.filename === process.argv[1]) {
  await main();
}
