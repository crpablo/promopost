import { list, put } from '@vercel/blob';

const CURSOR_PATHNAME = 'telegram-cursor.json';

export async function loadCursor(): Promise<number | null> {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  const { blobs } = await list({ prefix: CURSOR_PATHNAME, token });
  const match = blobs.find((b) => b.pathname === CURSOR_PATHNAME);
  if (!match) {
    return null;
  }
  const res = await fetch(match.url, {
    headers: { authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    throw new Error(`Falha ao carregar cursor do Telegram: ${res.status}`);
  }
  const data = await res.json();
  return typeof data.lastMessageId === 'number' ? data.lastMessageId : null;
}

export async function saveCursor(messageId: number): Promise<void> {
  await put(CURSOR_PATHNAME, JSON.stringify({ lastMessageId: messageId }), {
    access: 'private',
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: 'application/json',
    token: process.env.BLOB_READ_WRITE_TOKEN,
  });
}
