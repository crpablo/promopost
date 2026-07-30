import { afterEach, describe, expect, it, vi } from 'vitest';
import { postStoryToInstagram, postToInstagram } from './instagram';

function stubEnv() {
  vi.stubEnv('META_IG_BUSINESS_ACCOUNT_ID', '17841400000000000');
  vi.stubEnv('META_SYSTEM_USER_TOKEN', 'fake-token');
}

describe('postToInstagram', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.useRealTimers();
  });

  it('cria o container, espera ficar pronto (FINISHED) e depois publica, retornando o postId', async () => {
    stubEnv();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ id: 'container_1' }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ status_code: 'FINISHED' }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ id: 'media_999' }) });
    vi.stubGlobal('fetch', fetchMock);

    const result = await postToInstagram('https://x.com/img.jpg', 'legenda do post');

    expect(result).toEqual({ postId: 'media_999' });
    expect(fetchMock).toHaveBeenCalledTimes(3);

    const [createUrl, createOptions] = fetchMock.mock.calls[0];
    expect(createUrl).toBe('https://graph.facebook.com/v26.0/17841400000000000/media');
    expect(JSON.parse(createOptions.body)).toEqual({
      image_url: 'https://x.com/img.jpg',
      caption: 'legenda do post',
      access_token: 'fake-token',
    });

    const [statusUrl] = fetchMock.mock.calls[1];
    expect(statusUrl).toBe(
      'https://graph.facebook.com/v26.0/container_1?fields=status_code&access_token=fake-token',
    );

    const [publishUrl, publishOptions] = fetchMock.mock.calls[2];
    expect(publishUrl).toBe('https://graph.facebook.com/v26.0/17841400000000000/media_publish');
    expect(JSON.parse(publishOptions.body)).toEqual({
      creation_id: 'container_1',
      access_token: 'fake-token',
    });
  });

  it('espera o container sair de IN_PROGRESS antes de publicar', async () => {
    vi.useFakeTimers();
    stubEnv();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ id: 'container_1' }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ status_code: 'IN_PROGRESS' }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ status_code: 'FINISHED' }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ id: 'media_999' }) });
    vi.stubGlobal('fetch', fetchMock);

    const resultPromise = postToInstagram('https://x.com/img.jpg', 'legenda do post');
    await vi.runAllTimersAsync();
    const result = await resultPromise;

    expect(result).toEqual({ postId: 'media_999' });
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it('lança erro quando o container fica com status ERROR', async () => {
    stubEnv();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ id: 'container_1' }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ status_code: 'ERROR' }) });
    vi.stubGlobal('fetch', fetchMock);

    await expect(postToInstagram('https://x.com/img.jpg', 'legenda')).rejects.toThrow(
      'Falha ao processar mídia do Instagram: status ERROR no container',
    );
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
      .mockResolvedValueOnce({ ok: true, json: async () => ({ status_code: 'FINISHED' }) })
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

describe('postStoryToInstagram', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.useRealTimers();
  });

  it('cria o container como STORIES, sem legenda, espera ficar pronto e publica', async () => {
    stubEnv();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ id: 'container_1' }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ status_code: 'FINISHED' }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ id: 'story_999' }) });
    vi.stubGlobal('fetch', fetchMock);

    const result = await postStoryToInstagram('https://promopost.vercel.app/api/story-image?x=y');

    expect(result).toEqual({ postId: 'story_999' });
    expect(fetchMock).toHaveBeenCalledTimes(3);

    const [createUrl, createOptions] = fetchMock.mock.calls[0];
    expect(createUrl).toBe('https://graph.facebook.com/v26.0/17841400000000000/media');
    expect(JSON.parse(createOptions.body)).toEqual({
      image_url: 'https://promopost.vercel.app/api/story-image?x=y',
      media_type: 'STORIES',
      access_token: 'fake-token',
    });

    const [publishUrl, publishOptions] = fetchMock.mock.calls[2];
    expect(publishUrl).toBe('https://graph.facebook.com/v26.0/17841400000000000/media_publish');
    expect(JSON.parse(publishOptions.body)).toEqual({
      creation_id: 'container_1',
      access_token: 'fake-token',
    });
  });

  it('lança erro quando a criação do container do Story falha', async () => {
    stubEnv();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        json: async () => ({ error: { message: 'Imagem inválida' } }),
      }),
    );

    await expect(postStoryToInstagram('https://x.com/story.png')).rejects.toThrow(
      'Falha ao criar mídia do Story: Imagem inválida',
    );
  });

  it('lança erro quando a publicação do Story falha', async () => {
    stubEnv();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ id: 'container_1' }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ status_code: 'FINISHED' }) })
      .mockResolvedValueOnce({
        ok: false,
        json: async () => ({ error: { message: 'Container expirado' } }),
      });
    vi.stubGlobal('fetch', fetchMock);

    await expect(postStoryToInstagram('https://x.com/story.png')).rejects.toThrow(
      'Falha ao publicar Story do Instagram: Container expirado',
    );
  });

  it('lança erro quando faltam variáveis de ambiente', async () => {
    await expect(postStoryToInstagram('https://x.com/story.png')).rejects.toThrow(
      'Variáveis de ambiente da Meta ausentes',
    );
  });
});
