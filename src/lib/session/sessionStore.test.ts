import { afterEach, describe, expect, it, vi } from 'vitest';

const { readBufferFileMock } = vi.hoisted(() => ({
  readBufferFileMock: vi.fn(),
}));

vi.mock('../storage/localStore', () => ({
  readBufferFile: readBufferFileMock,
  resolveDataPath: (filename: string) => `/data/${filename}`,
}));

import { loadSession } from './sessionStore';

describe('loadSession', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('lê a sessão do arquivo local como Buffer', async () => {
    readBufferFileMock.mockResolvedValue(Buffer.from('{"cookies":[]}'));

    const buffer = await loadSession();

    expect(buffer.toString()).toBe('{"cookies":[]}');
    expect(readBufferFileMock).toHaveBeenCalledWith('ml-session.json');
  });

  it('lança erro quando o arquivo de sessão não existe', async () => {
    readBufferFileMock.mockResolvedValue(null);

    await expect(loadSession()).rejects.toThrow(
      'Arquivo de sessão do Mercado Livre não encontrado: /data/ml-session.json',
    );
  });
});
