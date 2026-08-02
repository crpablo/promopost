import { afterEach, describe, expect, it, vi } from 'vitest';

const { readTextFileMock } = vi.hoisted(() => ({
  readTextFileMock: vi.fn(),
}));

vi.mock('../storage/localStore', () => ({
  readTextFile: readTextFileMock,
  resolveDataPath: (filename: string) => `/data/${filename}`,
}));

import { loadSession } from './sessionStore';

describe('loadSession', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('lê a sessão do arquivo local, já sem espaços nas pontas', async () => {
    readTextFileMock.mockResolvedValue('1BQANOTE...sessionstring...');

    const session = await loadSession();

    expect(session).toBe('1BQANOTE...sessionstring...');
    expect(readTextFileMock).toHaveBeenCalledWith('telegram-session.txt');
  });

  it('lança erro quando o arquivo de sessão não existe', async () => {
    readTextFileMock.mockResolvedValue(null);

    await expect(loadSession()).rejects.toThrow(
      'Arquivo de sessão do Telegram não encontrado: /data/telegram-session.txt',
    );
  });
});
