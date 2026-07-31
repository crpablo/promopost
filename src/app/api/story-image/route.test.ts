import { afterEach, describe, expect, it, vi } from 'vitest';
import { GET } from './route';

describe('GET /api/story-image', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });


  it('retorna 400 quando falta o parâmetro imageUrl', async () => {
    const request = new Request(
      'https://promopost.example.com/api/story-image?title=Produto&price=99.9',
    );
    const response = await GET(request);
    const json = await response.json();

    expect(response.status).toBe(400);
    expect(json).toEqual({
      erro: 'Parâmetros obrigatórios ausentes: imageUrl, title, price',
    });
  });

  it('retorna 400 quando não tem nenhum parâmetro', async () => {
    const request = new Request('https://promopost.example.com/api/story-image');
    const response = await GET(request);

    expect(response.status).toBe(400);
  });

  it('retorna 400 quando imageUrl não é de um host permitido', async () => {
    const request = new Request(
      'https://promopost.example.com/api/story-image?imageUrl=https://evil.example.com/x.jpg&title=Produto&price=99.9',
    );
    const response = await GET(request);
    const json = await response.json();

    expect(response.status).toBe(400);
    expect(json).toEqual({ erro: 'Host da imagem não permitido' });
  });

  it('aceita imageUrl de host susercontent.com (Shopee) sem cair no erro de host não permitido', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404 }));

    const request = new Request(
      'https://promopost.example.com/api/story-image?imageUrl=' +
        encodeURIComponent('https://down-br.img.susercontent.com/img.jpg') +
        '&title=Produto&price=99.9',
    );
    const response = await GET(request);
    const json = await response.json();

    expect(response.status).not.toBe(400);
    expect(json.erro).not.toBe('Host da imagem não permitido');
  });

  it('retorna 400 quando price não é um número válido', async () => {
    const request = new Request(
      'https://promopost.example.com/api/story-image?imageUrl=https://http2.mlstatic.com/img.jpg&title=Produto&price=abc',
    );
    const response = await GET(request);
    const json = await response.json();

    expect(response.status).toBe(400);
    expect(json).toEqual({ erro: 'Parâmetro price inválido' });
  });

  it('retorna 400 quando discountedPrice não é um número válido', async () => {
    const request = new Request(
      'https://promopost.example.com/api/story-image?imageUrl=https://http2.mlstatic.com/img.jpg&title=Produto&price=99.9&discountedPrice=xyz',
    );
    const response = await GET(request);
    const json = await response.json();

    expect(response.status).toBe(400);
    expect(json).toEqual({ erro: 'Parâmetro discountedPrice inválido' });
  });
});
