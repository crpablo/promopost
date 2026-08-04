// src/app/api/coupon-image/route.test.ts
import { describe, expect, it } from 'vitest';
import { GET } from './route';

describe('GET /api/coupon-image', () => {
  it('retorna 400 quando falta o parâmetro coupon', async () => {
    const request = new Request('https://promopost.example.com/api/coupon-image');
    const response = await GET(request);
    const json = await response.json();

    expect(response.status).toBe(400);
    expect(json).toEqual({ erro: 'Parâmetro obrigatório ausente: coupon' });
  });

  it('retorna 400 quando discountPercent não é um número válido', async () => {
    const request = new Request(
      'https://promopost.example.com/api/coupon-image?coupon=LIVROSJOGOSRELAMPAGO&discountPercent=abc',
    );
    const response = await GET(request);
    const json = await response.json();

    expect(response.status).toBe(400);
    expect(json).toEqual({ erro: 'Parâmetro discountPercent inválido' });
  });

  it('retorna 400 quando minPurchaseValue não é um número válido', async () => {
    const request = new Request(
      'https://promopost.example.com/api/coupon-image?coupon=LIVROSJOGOSRELAMPAGO&minPurchaseValue=abc',
    );
    const response = await GET(request);
    const json = await response.json();

    expect(response.status).toBe(400);
    expect(json).toEqual({ erro: 'Parâmetro minPurchaseValue inválido' });
  });

  it('retorna 400 quando maxDiscountValue não é um número válido', async () => {
    const request = new Request(
      'https://promopost.example.com/api/coupon-image?coupon=LIVROSJOGOSRELAMPAGO&maxDiscountValue=abc',
    );
    const response = await GET(request);
    const json = await response.json();

    expect(response.status).toBe(400);
    expect(json).toEqual({ erro: 'Parâmetro maxDiscountValue inválido' });
  });

  it('retorna 200 com content-type image/jpeg quando só coupon é informado', async () => {
    const request = new Request('https://promopost.example.com/api/coupon-image?coupon=LIVROSJOGOSRELAMPAGO');
    const response = await GET(request);

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('image/jpeg');
  });

  it('retorna 200 com content-type image/jpeg quando todos os parâmetros são informados', async () => {
    const request = new Request(
      'https://promopost.example.com/api/coupon-image?coupon=LIVROSJOGOSRELAMPAGO&discountPercent=20&minPurchaseValue=59&maxDiscountValue=30',
    );
    const response = await GET(request);

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('image/jpeg');
  });
});
