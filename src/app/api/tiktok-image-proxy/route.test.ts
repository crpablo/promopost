import { afterEach, describe, expect, it, vi } from 'vitest';

const JPEG_OUTPUT_BYTES = new Uint8Array([9, 9, 9, 9]);

const { jpegMock, toBufferMock, sharpMock } = vi.hoisted(() => {
  const toBufferMock = vi.fn();
  const jpegMock = vi.fn(() => ({ toBuffer: toBufferMock }));
  const sharpMock = vi.fn(() => ({ jpeg: jpegMock }));
  return { jpegMock, toBufferMock, sharpMock };
});

vi.mock('sharp', () => ({ default: sharpMock }));

import { GET } from './route';

describe('GET /api/tiktok-image-proxy', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('busca a imagem e normaliza para JPEG, sempre — independente do content-type original', async () => {
    const imageBytes = new Uint8Array([1, 2, 3, 4]);
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        headers: new Headers({ 'content-type': 'image/webp' }),
        arrayBuffer: async () => imageBytes.buffer,
      }),
    );
    toBufferMock.mockResolvedValue(Buffer.from(JPEG_OUTPUT_BYTES));

    const request = new Request(
      'https://promopost.example.com/api/tiktok-image-proxy?imageUrl=' +
        encodeURIComponent('https://http2.mlstatic.com/D_1.jpg'),
    );
    const response = await GET(request);
    const body = new Uint8Array(await response.arrayBuffer());

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('image/jpeg');
    expect(body).toEqual(JPEG_OUTPUT_BYTES);
    expect(sharpMock).toHaveBeenCalledWith(Buffer.from(imageBytes));
    expect(jpegMock).toHaveBeenCalledWith({ quality: 90 });
  });

  it('busca e normaliza imagem de host susercontent.com (Shopee) sem cair no erro de host não permitido', async () => {
    const imageBytes = new Uint8Array([1, 2, 3, 4]);
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        headers: new Headers({ 'content-type': 'image/webp' }),
        arrayBuffer: async () => imageBytes.buffer,
      }),
    );
    toBufferMock.mockResolvedValue(Buffer.from(JPEG_OUTPUT_BYTES));

    const request = new Request(
      'https://promopost.example.com/api/tiktok-image-proxy?imageUrl=' +
        encodeURIComponent('https://down-br.img.susercontent.com/img.jpg'),
    );
    const response = await GET(request);
    const body = new Uint8Array(await response.arrayBuffer());

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('image/jpeg');
    expect(body).toEqual(JPEG_OUTPUT_BYTES);
  });

  it('busca e normaliza imagem de host media-amazon.com (Amazon) sem cair no erro de host não permitido', async () => {
    const imageBytes = new Uint8Array([1, 2, 3, 4]);
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        headers: new Headers({ 'content-type': 'image/webp' }),
        arrayBuffer: async () => imageBytes.buffer,
      }),
    );
    toBufferMock.mockResolvedValue(Buffer.from(JPEG_OUTPUT_BYTES));

    const request = new Request(
      'https://promopost.example.com/api/tiktok-image-proxy?imageUrl=' +
        encodeURIComponent('https://m.media-amazon.com/images/I/abc.jpg'),
    );
    const response = await GET(request);
    const body = new Uint8Array(await response.arrayBuffer());

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('image/jpeg');
    expect(body).toEqual(JPEG_OUTPUT_BYTES);
  });

  it('busca e normaliza imagem de host mlcdn.com.br (Magalu) sem cair no erro de host não permitido', async () => {
    const imageBytes = new Uint8Array([1, 2, 3, 4]);
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        headers: new Headers({ 'content-type': 'image/webp' }),
        arrayBuffer: async () => imageBytes.buffer,
      }),
    );
    toBufferMock.mockResolvedValue(Buffer.from(JPEG_OUTPUT_BYTES));

    const request = new Request(
      'https://promopost.example.com/api/tiktok-image-proxy?imageUrl=' +
        encodeURIComponent('https://a-static.mlcdn.com.br/img.jpg'),
    );
    const response = await GET(request);
    const body = new Uint8Array(await response.arrayBuffer());

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('image/jpeg');
    expect(body).toEqual(JPEG_OUTPUT_BYTES);
  });

  it('retorna 502 quando a normalização para JPEG falha', async () => {
    const imageBytes = new Uint8Array([1, 2, 3, 4]);
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        headers: new Headers({ 'content-type': 'image/webp' }),
        arrayBuffer: async () => imageBytes.buffer,
      }),
    );
    toBufferMock.mockRejectedValue(new Error('formato não suportado'));

    const request = new Request(
      'https://promopost.example.com/api/tiktok-image-proxy?imageUrl=' +
        encodeURIComponent('https://http2.mlstatic.com/D_1.jpg'),
    );
    const response = await GET(request);
    const json = await response.json();

    expect(response.status).toBe(502);
    expect(json.erro).toContain('Falha ao normalizar a imagem para JPEG');
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
