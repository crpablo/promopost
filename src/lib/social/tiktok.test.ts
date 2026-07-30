import { afterEach, describe, expect, it, vi } from 'vitest';

const { loadTikTokTokensMock, saveTikTokTokensMock } = vi.hoisted(() => ({
  loadTikTokTokensMock: vi.fn(),
  saveTikTokTokensMock: vi.fn(),
}));

vi.mock('./tiktokTokenStore', () => ({
  loadTikTokTokens: loadTikTokTokensMock,
  saveTikTokTokens: saveTikTokTokensMock,
}));

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

    const [initUrl, initOptions] = fetchMock.mock.calls[0];
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

    const [statusUrl, statusOptions] = fetchMock.mock.calls[1];
    expect(statusUrl).toBe('https://open.tiktokapis.com/v2/post/publish/status/fetch/');
    expect(JSON.parse(statusOptions.body)).toEqual({ publish_id: 'pub_1' });
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

    const [initUrl, initOptions] = fetchMock.mock.calls[1];
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
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ error: { code: 'invalid_params', message: 'Imagem inválida' } }),
      }),
    );

    await expect(postToTikTok('https://x.com/img.jpg', 'Produto X', 'legenda')).rejects.toThrow(
      'Falha ao publicar no TikTok: Imagem inválida',
    );
  });

  it('lança erro quando o status da publicação vem como FAILED', async () => {
    stubEnv();
    loadTikTokTokensMock.mockResolvedValue(VALID_TOKENS);
    const fetchMock = vi
      .fn()
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
});
