#!/usr/bin/env node
// Rodar localmente UMA VEZ (ou sempre que a sessão do Telegram expirar):
//   TELEGRAM_API_ID=xxx TELEGRAM_API_HASH=xxx BLOB_READ_WRITE_TOKEN=xxx node scripts/bootstrap-telegram-session.mjs
//
// TELEGRAM_API_ID e TELEGRAM_API_HASH vêm de https://my.telegram.org (Apps).
//
// Loga interativamente (telefone + código SMS + senha de duas etapas, se
// houver) usando a API oficial de cliente do Telegram (GramJS/MTProto) —
// use uma conta secundária dedicada, não sua conta pessoal principal.
// Salva a sessão resultante no Vercel Blob e lista os chats (dialogs) da
// conta pra você identificar o ID do grupo/canal alvo.

import { TelegramClient } from 'teleproto';
import { StringSession } from 'teleproto/sessions/index.js';
import input from 'input';
import { put } from '@vercel/blob';

async function main() {
  const apiId = Number(process.env.TELEGRAM_API_ID);
  const apiHash = process.env.TELEGRAM_API_HASH;
  if (!apiId || !apiHash) {
    console.error(
      'Defina TELEGRAM_API_ID e TELEGRAM_API_HASH antes de rodar (pegue em https://my.telegram.org).',
    );
    process.exit(1);
  }
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    console.error('Defina BLOB_READ_WRITE_TOKEN antes de rodar este script.');
    process.exit(1);
  }

  const client = new TelegramClient(new StringSession(''), apiId, apiHash, {
    connectionRetries: 5,
  });

  await client.start({
    phoneNumber: async () =>
      await input.text('Número de telefone (com código do país, ex: +5511999999999): '),
    password: async () =>
      await input.text('Senha de verificação em duas etapas (deixe em branco se não tiver): '),
    phoneCode: async () => await input.text('Código recebido por SMS/Telegram: '),
    onError: (err) => console.error(err),
  });

  const sessionString = client.session.save();

  const blob = await put('telegram-session.txt', sessionString, {
    access: 'private',
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: 'text/plain',
    token: process.env.BLOB_READ_WRITE_TOKEN,
  });

  console.log('\nSessão salva.');
  console.log('Configure na Vercel: TELEGRAM_SESSION_BLOB_URL =', blob.url);

  console.log('\nChats desta conta (pra identificar o ID do grupo/canal alvo):');
  const dialogs = await client.getDialogs({ limit: 50 });
  for (const dialog of dialogs) {
    console.log(`  ${dialog.id} — ${dialog.title ?? dialog.name ?? '(sem título)'}`);
  }
  console.log('\nConfigure na Vercel: TELEGRAM_TARGET_CHAT_ID = <ID do chat listado acima>');

  await client.disconnect();
}

main();
