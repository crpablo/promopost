import { afterEach, describe, expect, it, vi } from 'vitest';

const { listMock, putMock } = vi.hoisted(() => ({
  listMock: vi.fn(),
  putMock: vi.fn(),
}));

vi.mock('@vercel/blob', () => ({
  list: listMock,
  put: putMock,
}));

import { loadCursor, saveCursor } from './cursorStore';

describe('loadCursor', () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it('retorna null quando não existe cursor salvo ainda', async () => {
    listMock.mockResolvedValue({ blobs: [] });

    const cursor = await loadCursor();

    expect(cursor).toBeNull();
  });

  it('baixa e retorna o lastMessageId do cursor salvo', async () => {
    listMock.mockResolvedValue({
      blobs: [{ pathname: 'telegram-cursor.json', url: 'https://blob.vercel-storage.com/telegram-cursor.json' }],
    });
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ lastMessageId: 4242 }) }),
    );

    const cursor = await loadCursor();

    expect(cursor).toBe(4242);
  });

  it('lança erro quando o download do cursor falha', async () => {
    listMock.mockResolvedValue({
      blobs: [{ pathname: 'telegram-cursor.json', url: 'https://blob.vercel-storage.com/telegram-cursor.json' }],
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 }));

    await expect(loadCursor()).rejects.toThrow('Falha ao carregar cursor do Telegram: 500');
  });
});

describe('saveCursor', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('grava o lastMessageId no pathname fixo, sobrescrevendo o anterior', async () => {
    putMock.mockResolvedValue({ url: 'https://blob.vercel-storage.com/telegram-cursor.json' });

    await saveCursor(4242);

    expect(putMock).toHaveBeenCalledWith(
      'telegram-cursor.json',
      JSON.stringify({ lastMessageId: 4242 }),
      expect.objectContaining({ access: 'private', allowOverwrite: true, addRandomSuffix: false }),
    );
  });
});
