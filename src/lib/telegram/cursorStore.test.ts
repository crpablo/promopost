import { afterEach, describe, expect, it, vi } from 'vitest';

const { readJsonFileMock, writeJsonFileMock } = vi.hoisted(() => ({
  readJsonFileMock: vi.fn(),
  writeJsonFileMock: vi.fn(),
}));

vi.mock('../storage/localStore', () => ({
  readJsonFile: readJsonFileMock,
  writeJsonFile: writeJsonFileMock,
}));

import { loadCursor, saveCursor } from './cursorStore';

describe('loadCursor', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('retorna null quando não existe cursor salvo ainda', async () => {
    readJsonFileMock.mockResolvedValue(null);

    const cursor = await loadCursor();

    expect(cursor).toBeNull();
    expect(readJsonFileMock).toHaveBeenCalledWith('telegram-cursor.json');
  });

  it('retorna o lastMessageId do cursor salvo', async () => {
    readJsonFileMock.mockResolvedValue({ lastMessageId: 4242 });

    const cursor = await loadCursor();

    expect(cursor).toBe(4242);
  });

  it('lança erro em português quando a leitura falha', async () => {
    readJsonFileMock.mockRejectedValue(new Error('disk error'));

    await expect(loadCursor()).rejects.toThrow('Falha ao carregar cursor do Telegram: disk error');
  });
});

describe('saveCursor', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('grava o lastMessageId no arquivo fixo', async () => {
    writeJsonFileMock.mockResolvedValue(undefined);

    await saveCursor(4242);

    expect(writeJsonFileMock).toHaveBeenCalledWith('telegram-cursor.json', { lastMessageId: 4242 });
  });

  it('lança erro em português quando a escrita falha', async () => {
    writeJsonFileMock.mockRejectedValue(new Error('disk full'));

    await expect(saveCursor(4242)).rejects.toThrow('Falha ao salvar cursor do Telegram: disk full');
  });
});
