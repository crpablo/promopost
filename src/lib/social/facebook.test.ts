import { afterEach, describe, expect, it, vi } from 'vitest';
import { postToFacebook } from './facebook';

function stubEnv() {
  vi.stubEnv('META_PAGE_ID', '123456789');
  vi.stubEnv('META_SYSTEM_USER_TOKEN', 'fake-token');
}

describe('postToFacebook', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('posta a foto na Página e retorna o postId', async () => {
    stubEnv();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: 'photo_1', post_id: '123456789_999' }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await postToFacebook('https://x.com/img.jpg', 'legenda do post');

    expect(result).toEqual({ postId: '123456789_999' });
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe('https://graph.facebook.com/v26.0/123456789/photos');
    const parsedBody = JSON.parse(options.body);
    expect(parsedBody).toEqual({
      url: 'https://x.com/img.jpg',
      caption: 'legenda do post',
      access_token: 'fake-token',
    });
  });

  it('lança erro quando a API retorna erro', async () => {
    stubEnv();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        json: async () => ({ error: { message: 'Token inválido' } }),
      }),
    );

    await expect(postToFacebook('https://x.com/img.jpg', 'legenda')).rejects.toThrow(
      'Falha ao postar no Facebook: Token inválido',
    );
  });

  it('lança erro quando faltam variáveis de ambiente', async () => {
    await expect(postToFacebook('https://x.com/img.jpg', 'legenda')).rejects.toThrow(
      'Variáveis de ambiente da Meta ausentes',
    );
  });
});
