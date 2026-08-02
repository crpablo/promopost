import { afterEach, describe, expect, it, vi } from 'vitest';

const { readJsonFileMock, writeJsonFileMock } = vi.hoisted(() => ({
  readJsonFileMock: vi.fn(),
  writeJsonFileMock: vi.fn(),
}));

vi.mock('../storage/localStore', () => ({
  readJsonFile: readJsonFileMock,
  writeJsonFile: writeJsonFileMock,
}));

import { exchangeTikTokToken, loadTikTokTokens, saveTikTokTokens } from './tiktokTokenStore';

describe('loadTikTokTokens', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('retorna null quando não existe token salvo ainda', async () => {
    readJsonFileMock.mockResolvedValue(null);

    const tokens = await loadTikTokTokens();

    expect(tokens).toBeNull();
    expect(readJsonFileMock).toHaveBeenCalledWith('tiktok-tokens.json');
  });

  it('retorna o token salvo', async () => {
    readJsonFileMock.mockResolvedValue({ accessToken: 'act123', refreshToken: 'rft456', expiresAt: 1234567890 });

    const tokens = await loadTikTokTokens();

    expect(tokens).toEqual({ accessToken: 'act123', refreshToken: 'rft456', expiresAt: 1234567890 });
  });

  it('lança erro em português quando a leitura falha', async () => {
    readJsonFileMock.mockRejectedValue(new Error('disk error'));

    await expect(loadTikTokTokens()).rejects.toThrow('Falha ao carregar token do TikTok: disk error');
  });
});

describe('saveTikTokTokens', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('grava o token no arquivo fixo', async () => {
    writeJsonFileMock.mockResolvedValue(undefined);

    await saveTikTokTokens({ accessToken: 'act123', refreshToken: 'rft456', expiresAt: 1234567890 });

    expect(writeJsonFileMock).toHaveBeenCalledWith('tiktok-tokens.json', {
      accessToken: 'act123',
      refreshToken: 'rft456',
      expiresAt: 1234567890,
    });
  });

  it('lança erro em português quando a escrita falha', async () => {
    writeJsonFileMock.mockRejectedValue(new Error('disk full'));

    await expect(
      saveTikTokTokens({ accessToken: 'act123', refreshToken: 'rft456', expiresAt: 1234567890 }),
    ).rejects.toThrow('Falha ao salvar token do TikTok: disk full');
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
