import { TelegramClient } from 'teleproto';
import { StringSession } from 'teleproto/sessions/index.js';
import { extractPromo } from '@/lib/telegram/extractPromo';
import { loadCursor, saveCursor } from '@/lib/telegram/cursorStore';
import { loadSession } from '@/lib/telegram/sessionStore';
import { pollTelegram, type TelegramMessage } from '@/lib/telegram/poller';

export const maxDuration = 300;

async function fetchNewMessages(afterId: number | null): Promise<TelegramMessage[]> {
  const sessionString = await loadSession();
  const apiId = Number(process.env.TELEGRAM_API_ID);
  const apiHash = process.env.TELEGRAM_API_HASH;
  const chatId = process.env.TELEGRAM_TARGET_CHAT_ID;

  if (!apiId || !apiHash) {
    throw new Error('TELEGRAM_API_ID / TELEGRAM_API_HASH não configurados');
  }
  if (!chatId) {
    throw new Error('TELEGRAM_TARGET_CHAT_ID não configurado');
  }

  const client = new TelegramClient(new StringSession(sessionString), apiId, apiHash, {
    connectionRetries: 3,
  });
  await client.connect();

  try {
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

async function callWebhook(body: {
  link: string;
  coupon?: string;
  discountedPrice?: number;
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
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return Response.json({ erro: 'não autorizado' }, { status: 401 });
  }

  try {
    const result = await pollTelegram({
      fetchNewMessages,
      loadCursor,
      saveCursor,
      extractPromo,
      callWebhook,
    });
    return Response.json(result, { status: 200 });
  } catch (err) {
    console.error('Erro no poller do Telegram:', err);
    return Response.json({ erro: (err as Error).message }, { status: 500 });
  }
}
