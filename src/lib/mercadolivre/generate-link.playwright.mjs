// Roda DENTRO da Vercel Sandbox (node generate-link.mjs <link-produto>).
// Usa a sessão salva em /vercel/sandbox/session.json (storageState do Playwright).
//
// Faz duas coisas na mesma sessão de browser:
//   1. Visita a página do produto e extrai título/preço/imagem do HTML.
//      (a API pública api.mercadolibre.com/items/{id} passou a exigir OAuth
//      e não serve mais pra isso — descoberto em validação manual real.)
//   2. Visita o gerador de link de afiliado (mercadolivre.com.br/afiliados/linkbuilder#hub,
//      só acessível pra conta já aprovada no Programa de Afiliados) e gera o link.
//
// Imprime em stdout um JSON: {"title","price","imageUrl","affiliateLink"}.
//
// O Mercado Livre bloqueia Chromium headless "puro" com uma página de erro
// genérica ("Hubo un error accediendo a esta pagina..."), mesmo com sessão
// válida — por isso o context abaixo usa user-agent real, esconde
// navigator.webdriver e passa --disable-blink-features=AutomationControlled.
// Sem isso, TODA navegação falha, não só a do link builder.

import { readFileSync } from 'node:fs';
import { chromium } from 'playwright';

const [, , productLink] = process.argv;

if (!productLink) {
  console.error('Uso: node generate-link.mjs <link-produto>');
  process.exit(1);
}

const storageState = JSON.parse(readFileSync('/vercel/sandbox/session.json', 'utf8'));

const browser = await chromium.launch({
  args: ['--disable-blink-features=AutomationControlled'],
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
  // 1. Dados do produto
  await page.goto(productLink, { waitUntil: 'domcontentloaded', timeout: 45000 });

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

  // 2. Link de afiliado
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

  await urlField.fill(productLink);
  await page.getByRole('button', { name: 'Gerar' }).click();

  const affiliateLink = await page.locator('#textfield-copyLink-1').inputValue({ timeout: 15000 });

  if (!affiliateLink || !affiliateLink.startsWith('http')) {
    throw new Error(`Campo de resultado sem link válido: "${affiliateLink}"`);
  }

  console.log(JSON.stringify({ title, price, imageUrl, affiliateLink: affiliateLink.trim() }));
} catch (err) {
  console.error(String(err));
  process.exit(1);
} finally {
  await browser.close();
}
