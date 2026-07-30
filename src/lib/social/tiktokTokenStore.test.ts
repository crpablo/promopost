import { afterEach, describe, expect, it, vi } from 'vitest';

const { listMock, putMock } = vi.hoisted(() => ({
  listMock: vi.fn(),
  putMock: vi.fn(),
}));

vi.mock('@vercel/blob', () => ({
  list: listMock,
  put: putMock,
}));

import { exchangeTikTokToken, loadTikTokTokens, saveTikTokTokens } from './tiktokTokenStore';

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

describe('exchangeTikTokToken', () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  function stubEnv() {
    vi.stubEnv('TIKTOK_CLIENT_KEY', 'fake-client-key');
    vi.stubEnv('TIKTOK_CLIENT_SECRET', 'fake-client-secret');
  }

  it('troca os parâmetros por um par de tokens válido', async () => {
    stubEnv();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ access_token: 'act123', refresh_token: 'rft456', expires_in: 86400 }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const tokens = await exchangeTikTokToken({ grant_type: 'authorization_code', code: 'abc' });

    expect(tokens.accessToken).toBe('act123');
    expect(tokens.refreshToken).toBe('rft456');
    expect(tokens.expiresAt).toBeGreaterThan(Date.now());

    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe('https://open.tiktokapis.com/v2/oauth/token/');
    expect(options.body.toString()).toContain('client_key=fake-client-key');
    expect(options.body.toString()).toContain('grant_type=authorization_code');
    expect(options.body.toString()).toContain('code=abc');
  });

  it('lança erro em português quando faltam variáveis de ambiente', async () => {
    await expect(exchangeTikTokToken({ grant_type: 'authorization_code', code: 'abc' })).rejects.toThrow(
      'Variáveis de ambiente do TikTok ausentes',
    );
  });

  it('lança erro quando a resposta não tem 200', async () => {
    stubEnv();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        json: async () => ({ error: 'invalid_grant', error_description: 'Código inválido' }),
      }),
    );

    await expect(exchangeTikTokToken({ grant_type: 'authorization_code', code: 'abc' })).rejects.toThrow(
      'Falha ao trocar token do TikTok: Código inválido',
    );
  });

  it('lança erro quando a resposta vem 200 mas sem refresh_token (evita corromper o token store)', async () => {
    stubEnv();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ access_token: 'act123', expires_in: 86400 }),
      }),
    );

    await expect(exchangeTikTokToken({ grant_type: 'authorization_code', code: 'abc' })).rejects.toThrow(
      'Falha ao trocar token do TikTok',
    );
  });

  it('lança erro quando a resposta vem 200 mas com expires_in ausente/inválido', async () => {
    stubEnv();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ access_token: 'act123', refresh_token: 'rft456' }),
      }),
    );

    await expect(exchangeTikTokToken({ grant_type: 'authorization_code', code: 'abc' })).rejects.toThrow(
      'Falha ao trocar token do TikTok',
    );
  });
});
