import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchProduct } from './productFetcher';

describe('fetchProduct', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('retorna título, preço e imagem a partir da API pública do Mercado Livre', async () => {
    const fakeResponse = {
      title: 'Fone de Ouvido Bluetooth XYZ',
      price: 149.9,
      thumbnail: 'https://http2.mlstatic.com/thumb.jpg',
      pictures: [{ secure_url: 'https://http2.mlstatic.com/full.jpg' }],
    };
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => fakeResponse,
    });
    vi.stubGlobal('fetch', fetchMock);

    const product = await fetchProduct('MLB1234567890');

    expect(fetchMock).toHaveBeenCalledWith('https://api.mercadolibre.com/items/MLB1234567890');
    expect(product).toEqual({
      title: 'Fone de Ouvido Bluetooth XYZ',
      price: 149.9,
      imageUrl: 'https://http2.mlstatic.com/full.jpg',
    });
  });

  it('usa thumbnail quando não há pictures', async () => {
    const fakeResponse = {
      title: 'Produto sem fotos extras',
      price: 50,
      thumbnail: 'https://http2.mlstatic.com/thumb.jpg',
      pictures: [],
    };
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: async () => fakeResponse }),
    );

    const product = await fetchProduct('MLB999');

    expect(product.imageUrl).toBe('https://http2.mlstatic.com/thumb.jpg');
  });

  it('lança erro quando a API responde com status de erro', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404 }));

    await expect(fetchProduct('MLB000')).rejects.toThrow('Mercado Livre item lookup failed: 404');
  });
});
