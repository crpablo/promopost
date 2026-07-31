import { head, put } from '@vercel/blob';

const CURSOR_PATHNAME = 'telegram-cursor.json';

// head() é Simple Operation na cobrança do Vercel Blob (list() é Advanced,
// com teto de 2.000/mês no tier gratuito) — como este poller roda a cada
// ~5min via cron, list() aqui esgotava a cota gratuita em poucos dias
// (descoberto em produção real, 2026-07-31: conta suspensa por excesso de
// Advanced Operations). head() dá a mesma informação (existe e a URL) sem
// contar pro limite.
export async function loadCursor(): Promise<number | null> {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  let blobUrl: string;
  try {
    const info = await head(CURSOR_PATHNAME, { token });
    blobUrl = info.url;
  } catch {
    return null;
  }
  const res = await fetch(blobUrl, {
    headers: { authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    throw new Error(`Falha ao carregar cursor do Telegram: ${res.status}`);
  }
  const data = await res.json();
  return typeof data.lastMessageId === 'number' ? data.lastMessageId : null;
}

export async function saveCursor(messageId: number): Promise<void> {
  try {
    await put(CURSOR_PATHNAME, JSON.stringify({ lastMessageId: messageId }), {
      access: 'private',
      addRandomSuffix: false,
      allowOverwrite: true,
      contentType: 'application/json',
      token: process.env.BLOB_READ_WRITE_TOKEN,
    });
  } catch (err) {
    throw new Error(`Falha ao salvar cursor do Telegram: ${(err as Error).message}`);
  }
}
