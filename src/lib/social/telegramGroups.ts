export interface TelegramGroupSendResult {
  groupId: string;
  ok: boolean;
  error?: string;
}

export interface TelegramGroupsResult {
  ok: boolean;
  results: TelegramGroupSendResult[];
  error?: string;
}

export interface TelegramGroupsDeps {
  sendPhotoToGroup: (groupId: string, imageUrl: string, caption: string) => Promise<void>;
}

export async function sendToTelegramGroups(
  groupIds: string[],
  imageUrl: string,
  caption: string,
  deps: TelegramGroupsDeps,
): Promise<TelegramGroupsResult> {
  const results: TelegramGroupSendResult[] = [];

  for (const groupId of groupIds) {
    try {
      await deps.sendPhotoToGroup(groupId, imageUrl, caption);
      results.push({ groupId, ok: true });
    } catch (err) {
      results.push({ groupId, ok: false, error: (err as Error).message });
    }
  }

  return { ok: results.some((r) => r.ok), results };
}

// Production wiring (no test — matches existing GramJS precedent)
import { TelegramClient } from 'teleproto';
import { StringSession } from 'teleproto/sessions/index.js';
import { loadSession } from '../telegram/sessionStore';

function readGroupIds(): string[] {
  const raw = process.env.TELEGRAM_TARGET_GROUP_IDS;
  if (!raw) return [];
  return raw
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean);
}

function readTelegramCredentials(): { apiId: number; apiHash: string } {
  const apiId = Number(process.env.TELEGRAM_API_ID);
  const apiHash = process.env.TELEGRAM_API_HASH;
  if (!apiId || !apiHash) {
    throw new Error('Variáveis de ambiente do Telegram ausentes: TELEGRAM_API_ID, TELEGRAM_API_HASH');
  }
  return { apiId, apiHash };
}

// Sem teste automatizado — mesma limitação já aceita pro resto da
// integração GramJS do projeto (fetchNewMessages/getLatestMessageId em
// src/app/api/telegram-poll/route.ts também não têm teste automatizado).
// A lógica testável fica isolada em sendToTelegramGroups, acima.
export async function postToTelegramGroups(imageUrl: string, caption: string): Promise<TelegramGroupsResult> {
  const groupIds = readGroupIds();
  if (groupIds.length === 0) {
    return { ok: false, results: [] };
  }

  let client: TelegramClient;
  try {
    const { apiId, apiHash } = readTelegramCredentials();
    const sessionString = await loadSession();
    client = new TelegramClient(new StringSession(sessionString), apiId, apiHash, {
      connectionRetries: 3,
    });
    await client.connect();
    // StringSession.save() não persiste o cache de entidades/accessHash —
    // getDialogs() popula esse cache antes do getEntity() funcionar de
    // forma confiável, mesmo padrão já usado em telegram-poll/route.ts.
    await client.getDialogs({ limit: 100 });
  } catch (err) {
    console.error('Erro ao conectar no Telegram pra disparar pros grupos:', err);
    return { ok: false, results: [], error: (err as Error).message };
  }

  try {
    const sendPhotoToGroup = async (groupId: string, url: string, cap: string): Promise<void> => {
      const entity = await client.getEntity(groupId);
      await client.sendFile(entity, { file: url, caption: cap });
    };
    return await sendToTelegramGroups(groupIds, imageUrl, caption, { sendPhotoToGroup });
  } finally {
    await client.disconnect().catch(() => {});
  }
}
