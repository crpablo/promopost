import { afterEach, describe, expect, it, vi } from 'vitest';

import { GET } from './route';

describe('GET /api/tiktok-image-proxy', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('busca a imagem e repassa o conteúdo e o content-type', async () => {
    const imageBytes = new Uint8Array([1, 2, 3, 4]);
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        headers: new Headers({ 'content-type': 'image/jpeg' }),
        arrayBuffer: async () => imageBytes.buffer,
      }),
    );

    const request = new Request(
      'https://promopost.example.com/api/tiktok-image-proxy?imageUrl=' +
        encodeURIComponent('https://http2.mlstatic.com/D_1.jpg'),
    );
    const response = await GET(request);
    const body = new Uint8Array(await response.arrayBuffer());

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('image/jpeg');
    expect(body).toEqual(imageBytes);
  });

  it('retorna 400 quando falta o parâmetro imageUrl', async () => {
    const request = new Request('https://promopost.example.com/api/tiktok-image-proxy');
    const response = await GET(request);

    expect(response.status).toBe(400);
  });

  it('retorna 400 quando o host da imagem não é permitido', async () => {
    const request = new Request(
      'https://promopost.example.com/api/tiktok-image-proxy?imageUrl=' +
        encodeURIComponent('https://evil.example.com/x.jpg'),
    );
    const response = await GET(request);

    expect(response.status).toBe(400);
  });

  it('retorna 502 quando a busca da imagem original falha', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404 }));

    const request = new Request(
      'https://promopost.example.com/api/tiktok-image-proxy?imageUrl=' +
        encodeURIComponent('https://http2.mlstatic.com/D_1.jpg'),
    );
    const response = await GET(request);

    expect(response.status).toBe(502);
  });
});
