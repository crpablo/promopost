#!/usr/bin/env node
// Rodar localmente UMA VEZ (ou sempre que a sessão do Mercado Livre expirar):
//   node scripts/bootstrap-session.mjs
//
// Abre um Chromium visível: logue manualmente no Mercado Livre e navegue até
// o painel de afiliados. Volte ao terminal e aperte ENTER — o script salva a
// sessão (cookies) em ./ml-session.json. Copie esse arquivo pro VPS com
// `scp ml-session.json usuario@vps:/opt/promopost/data/ml-session.json`.

import readline from 'node:readline/promises';
import { writeFile } from 'node:fs/promises';
import { stdin, stdout } from 'node:process';
import { chromium } from 'playwright';

async function main() {
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();

  await page.goto('https://www.mercadolivre.com.br/afiliados/linkbuilder#hub');

  const rl = readline.createInterface({ input: stdin, output: stdout });
  await rl.question(
    '\nLogue no Mercado Livre na janela aberta e navegue até o painel de afiliados.\n' +
      'Quando terminar, volte aqui e aperte ENTER para salvar a sessão...',
  );
  rl.close();

  const storageState = await context.storageState();
  await writeFile('ml-session.json', JSON.stringify(storageState));

  console.log('\nSessão salva em ./ml-session.json.');
  console.log('Copie pro VPS: scp ml-session.json usuario@vps:/opt/promopost/data/ml-session.json');

  await browser.close();
}

main();
