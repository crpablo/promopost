import { afterEach, describe, expect, it, vi } from 'vitest';

const { loadTikTokTokensMock, saveTikTokTokensMock } = vi.hoisted(() => ({
  loadTikTokTokensMock: vi.fn(),
  saveTikTokTokensMock: vi.fn(),
}));

// Mock parcial: mantém exchangeTikTokToken real (usa o fetch stub de cada
// teste) e só substitui load/save, que é o que os testes precisam controlar.
vi.mock('./tiktokTokenStore', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./tiktokTokenStore')>();
  return {
    ...actual,
    loadTikTokTokens: loadTikTokTokensMock,
    saveTikTokTokens: saveTikTokTokensMock,
  };
});

import { postToTikTok } from './tiktok';

function stubEnv() {
  vi.stubEnv('TIKTOK_CLIENT_KEY', 'fake-client-key');
  vi.stubEnv('TIKTOK_CLIENT_SECRET', 'fake-client-secret');
}

const VALID_TOKENS = {
  accessToken: 'valid-access-token',
  refreshToken: 'valid-refresh-token',
  expiresAt: Date.now() + 60 * 60 * 1000, // expira em 1h — não precisa renovar
};

function creatorInfoResponse(privacyLevelOptions: string[], commentDisabled = false) {
  return {
    ok: true,
    json: async () => ({
      data: { privacy_level_options: privacyLevelOptions, comment_disabled: commentDisabled },
      error: { code: 'ok' },
    }),
  };
}

describe('postToTikTok', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it('posta com o token salvo, sem renovar, quando ele ainda não está perto de expirar', async () => {
    stubEnv();
    loadTikTokTokensMock.mockResolvedValue(VALID_TOKENS);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(creatorInfoResponse(['PUBLIC_TO_EVERYONE', 'SELF_ONLY']))
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: { publish_id: 'pub_1' }, error: { code: 'ok' } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: { status: 'PUBLISH_COMPLETE' }, error: { code: 'ok' } }),
      });
    vi.stubGlobal('fetch', fetchMock);

    const result = await postToTikTok('https://x.com/img.jpg', 'Produto X', 'legenda completa');

    expect(result).toEqual({ postId: 'pub_1' });
    expect(saveTikTokTokensMock).not.toHaveBeenCalled();

    const [creatorInfoUrl, creatorInfoOptions] = fetchMock.mock.calls[0];
    expect(creatorInfoUrl).toBe('https://open.tiktokapis.com/v2/post/publish/creator_info/query/');
    expect(creatorInfoOptions.headers.Authorization).toBe('Bearer valid-access-token');

    const [initUrl, initOptions] = fetchMock.mock.calls[1];
    expect(initUrl).toBe('https://open.tiktokapis.com/v2/post/publish/content/init/');
    expect(initOptions.headers.Authorization).toBe('Bearer valid-access-token');
    expect(JSON.parse(initOptions.body)).toEqual({
      media_type: 'PHOTO',
      post_mode: 'DIRECT_POST',
      post_info: {
        title: 'Produto X',
        description: 'legenda completa',
        privacy_level: 'SELF_ONLY',
        disable_comment: false,
        auto_add_music: false,
        brand_content_toggle: false,
        brand_organic_toggle: false,
      },
      source_info: {
        source: 'PULL_FROM_URL',
        photo_images: ['https://x.com/img.jpg'],
        photo_cover_index: 0,
      },
    });

    const [statusUrl, statusOptions] = fetchMock.mock.calls[2];
    expect(statusUrl).toBe('https://open.tiktokapis.com/v2/post/publish/status/fetch/');
    expect(JSON.parse(statusOptions.body)).toEqual({ publish_id: 'pub_1' });
  });

  it('repassa disable_comment = true quando o creator_info reporta comment_disabled', async () => {
    stubEnv();
    loadTikTokTokensMock.mockResolvedValue(VALID_TOKENS);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(creatorInfoResponse(['SELF_ONLY'], true))
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: { publish_id: 'pub_1' }, error: { code: 'ok' } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: { status: 'PUBLISH_COMPLETE' }, error: { code: 'ok' } }),
      });
    vi.stubGlobal('fetch', fetchMock);

    await postToTikTok('https://x.com/img.jpg', 'Produto X', 'legenda completa');

    const [, initOptions] = fetchMock.mock.calls[1];
    expect(JSON.parse(initOptions.body).post_info.disable_comment).toBe(true);
  });

  it('lança erro quando a consulta de informações do criador falha', async () => {
    stubEnv();
    loadTikTokTokensMock.mockResolvedValue(VALID_TOKENS);
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        json: async () => ({ error: { code: 'access_token_invalid', message: 'Token inválido' } }),
      }),
    );

    await expect(postToTikTok('https://x.com/img.jpg', 'Produto X', 'legenda')).rejects.toThrow(
      'Falha ao consultar informações do criador no TikTok: Token inválido',
    );
  });

  it('lança erro quando SELF_ONLY não está entre as opções de privacidade do criador', async () => {
    stubEnv();
    loadTikTokTokensMock.mockResolvedValue(VALID_TOKENS);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(creatorInfoResponse(['PUBLIC_TO_EVERYONE'])));

    await expect(postToTikTok('https://x.com/img.jpg', 'Produto X', 'legenda')).rejects.toThrow(
      'SELF_ONLY não disponível',
    );
  });

  it('renova o token antes de postar quando ele está perto de expirar', async () => {
    stubEnv();
    loadTikTokTokensMock.mockResolvedValue({
      accessToken: 'old-access-token',
      refreshToken: 'old-refresh-token',
      expiresAt: Date.now() + 60 * 1000, // expira em 1min — precisa renovar
    });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          access_token: 'new-access-token',
          refresh_token: 'new-refresh-token',
          expires_in: 86400,
        }),
      })
      .mockResolvedValueOnce(creatorInfoResponse(['SELF_ONLY']))
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: { publish_id: 'pub_1' }, error: { code: 'ok' } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: { status: 'PUBLISH_COMPLETE' }, error: { code: 'ok' } }),
      });
    vi.stubGlobal('fetch', fetchMock);

    const result = await postToTikTok('https://x.com/img.jpg', 'Produto X', 'legenda completa');

    expect(result).toEqual({ postId: 'pub_1' });
    expect(saveTikTokTokensMock).toHaveBeenCalledWith(
      expect.objectContaining({ accessToken: 'new-access-token', refreshToken: 'new-refresh-token' }),
    );

    const [refreshUrl, refreshOptions] = fetchMock.mock.calls[0];
    expect(refreshUrl).toBe('https://open.tiktokapis.com/v2/oauth/token/');
    expect(refreshOptions.body.toString()).toContain('grant_type=refresh_token');
    expect(refreshOptions.body.toString()).toContain('refresh_token=old-refresh-token');

    const [initUrl, initOptions] = fetchMock.mock.calls[2];
    expect(initUrl).toBe('https://open.tiktokapis.com/v2/post/publish/content/init/');
    expect(initOptions.headers.Authorization).toBe('Bearer new-access-token');
  });

  it('lança erro quando a renovação do token falha', async () => {
    stubEnv();
    loadTikTokTokensMock.mockResolvedValue({
      accessToken: 'old-access-token',
      refreshToken: 'expired-refresh-token',
      expiresAt: Date.now() - 1000, // já expirado
    });
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        json: async () => ({ error: 'invalid_grant', error_description: 'Refresh token expirado' }),
      }),
    );

    await expect(postToTikTok('https://x.com/img.jpg', 'Produto X', 'legenda')).rejects.toThrow(
      'Falha ao renovar token do TikTok',
    );
  });

  it('lança erro quando não existe token salvo (nunca rodou o bootstrap)', async () => {
    stubEnv();
    loadTikTokTokensMock.mockResolvedValue(null);

    await expect(postToTikTok('https://x.com/img.jpg', 'Produto X', 'legenda')).rejects.toThrow(
      'Token do TikTok não configurado',
    );
  });

  it('lança erro quando a criação da publicação falha', async () => {
    stubEnv();
    loadTikTokTokensMock.mockResolvedValue(VALID_TOKENS);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(creatorInfoResponse(['SELF_ONLY']))
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ error: { code: 'invalid_params', message: 'Imagem inválida' } }),
      });
    vi.stubGlobal('fetch', fetchMock);

    await expect(postToTikTok('https://x.com/img.jpg', 'Produto X', 'legenda')).rejects.toThrow(
      'Falha ao publicar no TikTok: Imagem inválida',
    );
  });

  it('lança erro quando o status da publicação vem como FAILED', async () => {
    stubEnv();
    loadTikTokTokensMock.mockResolvedValue(VALID_TOKENS);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(creatorInfoResponse(['SELF_ONLY']))
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: { publish_id: 'pub_1' }, error: { code: 'ok' } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: { status: 'FAILED', fail_reason: 'picture_size_check_failed' },
          error: { code: 'ok' },
        }),
      });
    vi.stubGlobal('fetch', fetchMock);

    await expect(postToTikTok('https://x.com/img.jpg', 'Produto X', 'legenda')).rejects.toThrow(
      'Falha ao publicar no TikTok: picture_size_check_failed',
    );
  });

  it('lança erro quando faltam variáveis de ambiente', async () => {
    loadTikTokTokensMock.mockResolvedValue({
      accessToken: 'x',
      refreshToken: 'y',
      expiresAt: Date.now() - 1000, // força o caminho de renovação, que precisa das env vars
    });

    await expect(postToTikTok('https://x.com/img.jpg', 'Produto X', 'legenda')).rejects.toThrow(
      'Variáveis de ambiente do TikTok ausentes',
    );
  });

  it('lança erro e não salva quando a renovação retorna 200 sem refresh_token (evita corromper o token store)', async () => {
    stubEnv();
    loadTikTokTokensMock.mockResolvedValue({
      accessToken: 'old-access-token',
      refreshToken: 'old-refresh-token',
      expiresAt: Date.now() + 60 * 1000, // perto de expirar — força renovação
    });
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ access_token: 'new-access-token', expires_in: 86400 }), // sem refresh_token
      }),
    );

    await expect(postToTikTok('https://x.com/img.jpg', 'Produto X', 'legenda')).rejects.toThrow(
      'Falha ao renovar token do TikTok',
    );
    expect(saveTikTokTokensMock).not.toHaveBeenCalled();
  });

  it('lança erro em português quando o polling de status responde sem o campo data', async () => {
    stubEnv();
    loadTikTokTokensMock.mockResolvedValue(VALID_TOKENS);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(creatorInfoResponse(['SELF_ONLY']))
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: { publish_id: 'pub_1' }, error: { code: 'ok' } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ error: { code: 'ok' } }), // sem data
      });
    vi.stubGlobal('fetch', fetchMock);

    await expect(postToTikTok('https://x.com/img.jpg', 'Produto X', 'legenda')).rejects.toThrow(
      'Resposta inesperada da TikTok ao checar status da publicação',
    );
  });
});
