import { afterEach, describe, expect, it, vi } from 'vitest';

const { listMock, putMock } = vi.hoisted(() => ({
  listMock: vi.fn(),
  putMock: vi.fn(),
}));

vi.mock('@vercel/blob', () => ({
  list: listMock,
  put: putMock,
}));

import { loadTikTokTokens, saveTikTokTokens } from './tiktokTokenStore';

describe('loadTikTokTokens', () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it('retorna null quando não existe token salvo ainda', async () => {
    listMock.mockResolvedValue({ blobs: [] });

    const tokens = await loadTikTokTokens();

    expect(tokens).toBeNull();
  });

  it('baixa e retorna o token salvo', async () => {
    listMock.mockResolvedValue({
      blobs: [{ pathname: 'tiktok-tokens.json', url: 'https://blob.vercel-storage.com/tiktok-tokens.json' }],
    });
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ accessToken: 'act123', refreshToken: 'rft456', expiresAt: 1234567890 }),
      }),
    );

    const tokens = await loadTikTokTokens();

    expect(tokens).toEqual({ accessToken: 'act123', refreshToken: 'rft456', expiresAt: 1234567890 });
  });

  it('lança erro quando o download do token falha', async () => {
    listMock.mockResolvedValue({
      blobs: [{ pathname: 'tiktok-tokens.json', url: 'https://blob.vercel-storage.com/tiktok-tokens.json' }],
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 }));

    await expect(loadTikTokTokens()).rejects.toThrow('Falha ao carregar token do TikTok: 500');
  });
});

describe('saveTikTokTokens', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('grava o token no pathname fixo, sobrescrevendo o anterior', async () => {
    putMock.mockResolvedValue({ url: 'https://blob.vercel-storage.com/tiktok-tokens.json' });

    await saveTikTokTokens({ accessToken: 'act123', refreshToken: 'rft456', expiresAt: 1234567890 });

    expect(putMock).toHaveBeenCalledWith(
      'tiktok-tokens.json',
      JSON.stringify({ accessToken: 'act123', refreshToken: 'rft456', expiresAt: 1234567890 }),
      expect.objectContaining({ access: 'private', allowOverwrite: true, addRandomSuffix: false }),
    );
  });

  it('lança erro em português quando o upload do token falha', async () => {
    putMock.mockRejectedValue(new Error('network error'));

    await expect(
      saveTikTokTokens({ accessToken: 'act123', refreshToken: 'rft456', expiresAt: 1234567890 }),
    ).rejects.toThrow('Falha ao salvar token do TikTok: network error');
  });
});
