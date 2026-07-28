#!/usr/bin/env node
// Rodar localmente UMA VEZ (ou sempre que a sessão do Mercado Livre expirar):
//   BLOB_READ_WRITE_TOKEN=xxx node scripts/bootstrap-session.mjs
//
// Abre um Chromium visível: logue manualmente no Mercado Livre e navegue até
// o painel de afiliados. Volte ao terminal e aperte ENTER — o script salva a
// sessão (cookies) no Vercel Blob e imprime a URL que vai na env var
// ML_SESSION_BLOB_URL do projeto na Vercel.

import readline from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { put } from '@vercel/blob';
import { chromium } from 'playwright';

async function main() {
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    console.error('Defina BLOB_READ_WRITE_TOKEN antes de rodar este script.');
    process.exit(1);
  }

  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();

  await page.goto('https://www.mercadolivre.com.br/afiliados/linkbuilder');

  const rl = readline.createInterface({ input: stdin, output: stdout });
  await rl.question(
    '\nLogue no Mercado Livre na janela aberta e navegue até o painel de afiliados.\n' +
      'Quando terminar, volte aqui e aperte ENTER para salvar a sessão...',
  );
  rl.close();

  const storageState = await context.storageState();
  const buffer = Buffer.from(JSON.stringify(storageState));

  const blob = await put('ml-session.json', buffer, {
    access: 'private',
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: 'application/json',
    token: process.env.BLOB_READ_WRITE_TOKEN,
  });

  console.log('\nSessão salva.');
  console.log('Configure na Vercel: ML_SESSION_BLOB_URL =', blob.url);

  await browser.close();
}

main();
