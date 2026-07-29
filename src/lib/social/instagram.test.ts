import { afterEach, describe, expect, it, vi } from 'vitest';
import { postToInstagram } from './instagram';

function stubEnv() {
  vi.stubEnv('META_IG_BUSINESS_ACCOUNT_ID', '17841400000000000');
  vi.stubEnv('META_SYSTEM_USER_TOKEN', 'fake-token');
}

describe('postToInstagram', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('cria o container de mídia e depois publica, retornando o postId', async () => {
    stubEnv();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ id: 'container_1' }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ id: 'media_999' }) });
    vi.stubGlobal('fetch', fetchMock);

    const result = await postToInstagram('https://x.com/img.jpg', 'legenda do post');

    expect(result).toEqual({ postId: 'media_999' });
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const [createUrl, createOptions] = fetchMock.mock.calls[0];
    expect(createUrl).toBe('https://graph.facebook.com/v26.0/17841400000000000/media');
    expect(JSON.parse(createOptions.body)).toEqual({
      image_url: 'https://x.com/img.jpg',
      caption: 'legenda do post',
      access_token: 'fake-token',
    });

    const [publishUrl, publishOptions] = fetchMock.mock.calls[1];
    expect(publishUrl).toBe('https://graph.facebook.com/v26.0/17841400000000000/media_publish');
    expect(JSON.parse(publishOptions.body)).toEqual({
      creation_id: 'container_1',
      access_token: 'fake-token',
    });
  });

  it('lança erro quando a criação do container falha', async () => {
    stubEnv();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        json: async () => ({ error: { message: 'Imagem inválida' } }),
      }),
    );

    await expect(postToInstagram('https://x.com/img.jpg', 'legenda')).rejects.toThrow(
      'Falha ao criar mídia do Instagram: Imagem inválida',
    );
  });

  it('lança erro quando a publicação do container falha', async () => {
    stubEnv();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ id: 'container_1' }) })
      .mockResolvedValueOnce({
        ok: false,
        json: async () => ({ error: { message: 'Container expirado' } }),
      });
    vi.stubGlobal('fetch', fetchMock);

    await expect(postToInstagram('https://x.com/img.jpg', 'legenda')).rejects.toThrow(
      'Falha ao publicar mídia do Instagram: Container expirado',
    );
  });

  it('lança erro quando faltam variáveis de ambiente', async () => {
    await expect(postToInstagram('https://x.com/img.jpg', 'legenda')).rejects.toThrow(
      'Variáveis de ambiente da Meta ausentes',
    );
  });
});
