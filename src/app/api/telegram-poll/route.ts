import { TelegramClient } from 'teleproto';
import { StringSession } from 'teleproto/sessions/index.js';
import { coverWatermark } from '@/lib/magalu/photoOverlay';
import { extractPromo } from '@/lib/telegram/extractPromo';
import { loadCursor, saveCursor } from '@/lib/telegram/cursorStore';
import { acquireLock, releaseLock } from '@/lib/telegram/lock';
import { loadSession } from '@/lib/telegram/sessionStore';
import { pollTelegram, type TelegramMessage } from '@/lib/telegram/poller';
import { writeBufferFile } from '@/lib/storage/localStore';

export const maxDuration = 300;

function readTelegramEnv(): { apiId: number; apiHash: string; chatId: string } {
  const apiId = Number(process.env.TELEGRAM_API_ID);
  const apiHash = process.env.TELEGRAM_API_HASH;
  const chatId = process.env.TELEGRAM_TARGET_CHAT_ID;

  if (!apiId || !apiHash) {
    throw new Error('TELEGRAM_API_ID / TELEGRAM_API_HASH não configurados');
  }
  if (!chatId) {
    throw new Error('TELEGRAM_TARGET_CHAT_ID não configurado');
  }

  return { apiId, apiHash, chatId };
}

async function fetchNewMessages(afterId: number | null): Promise<TelegramMessage[]> {
  const { apiId, apiHash, chatId } = readTelegramEnv();
  const sessionString = await loadSession();

  const client = new TelegramClient(new StringSession(sessionString), apiId, apiHash, {
    connectionRetries: 3,
  });
  await client.connect();

  try {
    // StringSession.save() não persiste o cache de entidades/accessHash, então
    // toda invocação do cron é um "cold start" pro cliente — getDialogs()
    // popula esse cache antes do getEntity() abaixo.
    await client.getDialogs({ limit: 100 });

    const entity = await client.getEntity(chatId);
    const rawMessages = await client.getMessages(entity, {
      limit: 20,
      minId: afterId ?? 0,
      reverse: true,
    });

    return rawMessages
      .filter((m) => typeof m.message === 'string' && m.message.trim().length > 0)
      .map((m) => ({ id: m.id, text: m.message }));
  } finally {
    await client.disconnect();
  }
}

async function getLatestMessageId(): Promise<number | null> {
  const { apiId, apiHash, chatId } = readTelegramEnv();
  const sessionString = await loadSession();

  const client = new TelegramClient(new StringSession(sessionString), apiId, apiHash, {
    connectionRetries: 3,
  });
  await client.connect();

  try {
    await client.getDialogs({ limit: 100 });

    const entity = await client.getEntity(chatId);
    const messages = await client.getMessages(entity, { limit: 1 });

    return messages[0]?.id ?? null;
  } finally {
    await client.disconnect();
  }
}

async function downloadMessagePhoto(messageId: number): Promise<string | null> {
  const { apiId, apiHash, chatId } = readTelegramEnv();
  const sessionString = await loadSession();
  const baseUrl = process.env.WEBHOOK_BASE_URL;
  if (!baseUrl) {
    throw new Error('WEBHOOK_BASE_URL não configurado');
  }

  const client = new TelegramClient(new StringSession(sessionString), apiId, apiHash, {
    connectionRetries: 3,
  });
  await client.connect();

  try {
    await client.getDialogs({ limit: 100 });
    const entity = await client.getEntity(chatId);
    const messages = await client.getMessages(entity, { ids: [messageId] });
    const message = messages[0];
    if (!message || !message.media) {
      return null;
    }

    const buffer = await client.downloadMedia(message);
    if (!buffer || typeof buffer === 'string') {
      return null;
    }

    const covered = await coverWatermark(buffer);
    await writeBufferFile(`telegram-media/${messageId}.jpg`, covered);

    return `${baseUrl}/api/telegram-media?id=${messageId}`;
  } finally {
    await client.disconnect();
  }
}

async function callWebhook(body: {
  link: string;
  coupon?: string;
  discountedPrice?: number;
  discountPercent?: number;
  minPurchaseValue?: number;
  maxDiscountValue?: number;
}): Promise<{ ok: boolean; status: number }> {
  const baseUrl = process.env.WEBHOOK_BASE_URL;
  const secret = process.env.WEBHOOK_SECRET;
  if (!baseUrl || !secret) {
    throw new Error('WEBHOOK_BASE_URL / WEBHOOK_SECRET não configurados');
  }

  const res = await fetch(`${baseUrl}/api/webhook`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-promopost-secret': secret,
    },
    body: JSON.stringify(body),
  });

  return { ok: res.ok, status: res.status };
}

export async function GET(request: Request): Promise<Response> {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = request.headers.get('authorization');
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return Response.json({ erro: 'não autorizado' }, { status: 401 });
  }

  try {
    const result = await pollTelegram({
      fetchNewMessages,
      getLatestMessageId,
      loadCursor,
      saveCursor,
      extractPromo,
      downloadMessagePhoto,
      callWebhook,
      acquireLock,
      releaseLock,
    });

    for (const e of result.errors) {
      console.error(`Telegram message ${e.messageId} falhou: ${e.error} — texto: ${e.text.slice(0, 200)}`);
    }

    return Response.json(result, { status: 200 });
  } catch (err) {
    console.error('Erro no poller do Telegram:', err);
    return Response.json({ erro: (err as Error).message }, { status: 500 });
  }
}
