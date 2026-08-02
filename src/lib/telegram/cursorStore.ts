import { readJsonFile, writeJsonFile } from '../storage/localStore';

const CURSOR_FILENAME = 'telegram-cursor.json';

export async function loadCursor(): Promise<number | null> {
  let data: { lastMessageId?: number } | null;
  try {
    data = await readJsonFile<{ lastMessageId?: number }>(CURSOR_FILENAME);
  } catch (err) {
    throw new Error(`Falha ao carregar cursor do Telegram: ${(err as Error).message}`);
  }
  return typeof data?.lastMessageId === 'number' ? data.lastMessageId : null;
}

export async function saveCursor(messageId: number): Promise<void> {
  try {
    await writeJsonFile(CURSOR_FILENAME, { lastMessageId: messageId });
  } catch (err) {
    throw new Error(`Falha ao salvar cursor do Telegram: ${(err as Error).message}`);
  }
}
