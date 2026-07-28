// Roda DENTRO da Vercel Sandbox (node generate-link.mjs <link-produto>).
// Usa a sessão salva em /vercel/sandbox/session.json (storageState do Playwright).
//
// Seletores confirmados contra o painel real (mercadolivre.com.br/afiliados/linkbuilder#hub)
// em validação manual ponta-a-ponta. O link gerado usa o domínio meli.la, não
// mercadolivre.com/sec/... como se supunha antes de testar contra o site real.
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
  await page.goto('https://www.mercadolivre.com.br/afiliados/linkbuilder#hub', {
    waitUntil: 'domcontentloaded',
    timeout: 45000,
  });

  const urlField = page.locator('#url-0');
  const formVisible = await urlField
    .isVisible({ timeout: 15000 })
    .catch(() => false);

  if (!formVisible) {
    console.error('SESSION_EXPIRED');
    process.exit(1);
  }

  await urlField.fill(productLink);

  await page.getByRole('button', { name: 'Gerar' }).click();

  const generatedLink = await page
    .locator('#textfield-copyLink-1')
    .inputValue({ timeout: 15000 });

  if (!generatedLink || !generatedLink.startsWith('http')) {
    throw new Error(`Campo de resultado sem link válido: "${generatedLink}"`);
  }

  console.log(generatedLink.trim());
} catch (err) {
  console.error(String(err));
  process.exit(1);
} finally {
  await browser.close();
}
