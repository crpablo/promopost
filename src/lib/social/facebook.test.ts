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

  it('troca o token do Usuário do Sistema por um token de Página, depois posta a foto e retorna o postId', async () => {
    stubEnv();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ access_token: 'page-token' }) })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: 'photo_1', post_id: '123456789_999' }),
      });
    vi.stubGlobal('fetch', fetchMock);

    const result = await postToFacebook('https://x.com/img.jpg', 'legenda do post');

    expect(result).toEqual({ postId: '123456789_999' });
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const [tokenUrl] = fetchMock.mock.calls[0];
    expect(tokenUrl).toBe(
      'https://graph.facebook.com/v26.0/123456789?fields=access_token&access_token=fake-token',
    );

    const [postUrl, postOptions] = fetchMock.mock.calls[1];
    expect(postUrl).toBe('https://graph.facebook.com/v26.0/123456789/photos');
    const parsedBody = JSON.parse(postOptions.body);
    expect(parsedBody).toEqual({
      url: 'https://x.com/img.jpg',
      caption: 'legenda do post',
      access_token: 'page-token',
    });
  });

  it('lança erro quando a troca pelo token de Página falha', async () => {
    stubEnv();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        json: async () => ({ error: { message: 'System user sem acesso à Página' } }),
      }),
    );

    await expect(postToFacebook('https://x.com/img.jpg', 'legenda')).rejects.toThrow(
      'Falha ao obter token de acesso da Página: System user sem acesso à Página',
    );
  });

  it('lança erro quando a API retorna erro ao postar a foto', async () => {
    stubEnv();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ access_token: 'page-token' }) })
      .mockResolvedValueOnce({
        ok: false,
        json: async () => ({ error: { message: 'Token inválido' } }),
      });
    vi.stubGlobal('fetch', fetchMock);

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
