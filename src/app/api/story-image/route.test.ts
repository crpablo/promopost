import { describe, expect, it } from 'vitest';
import { GET } from './route';

describe('GET /api/story-image', () => {
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
});
