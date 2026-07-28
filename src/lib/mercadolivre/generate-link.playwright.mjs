// Roda DENTRO da Vercel Sandbox (node generate-link.mjs <link-produto>).
// Usa a sessão salva em /vercel/sandbox/session.json (storageState do Playwright).
//
// ATENÇÃO: os 3 seletores marcados "AJUSTAR" abaixo foram escritos sem acesso
// ao HTML real do painel de afiliados (exige login). Antes do primeiro uso em
// produção, abra o painel logado, inspecione os elementos reais e corrija os
// seletores (ver docs/runbook.md).

import { readFileSync } from 'node:fs';
import { chromium } from 'playwright';

const [, , productLink] = process.argv;

if (!productLink) {
  console.error('Uso: node generate-link.mjs <link-produto>');
  process.exit(1);
}

const storageState = JSON.parse(readFileSync('/vercel/sandbox/session.json', 'utf8'));

const browser = await chromium.launch();
const context = await browser.newContext({ storageState });
const page = await context.newPage();

try {
  await page.goto('https://www.mercadolivre.com.br/afiliados/linkbuilder', {
    waitUntil: 'domcontentloaded',
  });

  const loggedOut = await page
    .locator('text=Iniciar sessão')
    .first()
    .isVisible()
    .catch(() => false);

  if (loggedOut) {
    console.error('SESSION_EXPIRED');
    process.exit(1);
  }

  // AJUSTAR: placeholder do campo de input do link, confirmar no painel real.
  await page.getByPlaceholder('Cole o link do produto').fill(productLink);

  // AJUSTAR: texto do botão de gerar link, confirmar no painel real.
  await page.getByRole('button', { name: 'Gerar link' }).click();

  // AJUSTAR: seletor do elemento que mostra o link gerado, confirmar no painel real.
  const generatedLink = await page
    .locator('[data-testid="generated-affiliate-link"]')
    .innerText({ timeout: 15000 });

  console.log(generatedLink.trim());
} catch (err) {
  await page.screenshot({ path: '/vercel/sandbox/failure.png' }).catch(() => {});
  console.error(String(err));
  process.exit(1);
} finally {
  await browser.close();
}
