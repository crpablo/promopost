import { afterEach, describe, expect, it, vi } from 'vitest';

const { generateObjectMock } = vi.hoisted(() => ({ generateObjectMock: vi.fn() }));

vi.mock('ai', () => ({ generateObject: generateObjectMock }));

import { extractPromo } from './extractPromo';

describe('extractPromo', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('extrai link, cupom e preço com desconto de uma promo do Mercado Livre', async () => {
    generateObjectMock.mockResolvedValue({
      object: {
        isMercadoLivrePromo: true,
        link: 'https://www.mercadolivre.com.br/produto/p/MLB123',
        coupon: 'PROMO10',
        discountedPrice: 89.9,
      },
    });

    const result = await extractPromo(
      'Fone Bluetooth XYZ\nDe R$149,90 por R$99,90\nCupom: PROMO10\nhttps://www.mercadolivre.com.br/produto/p/MLB123',
    );

    expect(result).toEqual({
      isMercadoLivrePromo: true,
      link: 'https://www.mercadolivre.com.br/produto/p/MLB123',
      coupon: 'PROMO10',
      discountedPrice: 89.9,
    });
    expect(generateObjectMock).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: expect.stringContaining('Fone Bluetooth XYZ'),
      }),
    );
  });

  it('extrai promo sem cupom (coupon e discountedPrice nulos)', async () => {
    generateObjectMock.mockResolvedValue({
      object: {
        isMercadoLivrePromo: true,
        link: 'https://www.mercadolivre.com.br/produto/p/MLB999',
        coupon: null,
        discountedPrice: null,
      },
    });

    const result = await extractPromo('Produto legal https://www.mercadolivre.com.br/produto/p/MLB999');

    expect(result.coupon).toBeNull();
    expect(result.discountedPrice).toBeNull();
  });

  it('retorna isMercadoLivrePromo false pra mensagem que não é promo do Mercado Livre', async () => {
    generateObjectMock.mockResolvedValue({
      object: { isMercadoLivrePromo: false, link: null, coupon: null, discountedPrice: null },
    });

    const result = await extractPromo('Bom dia pessoal, tudo certo?');

    expect(result.isMercadoLivrePromo).toBe(false);
  });

  it('extrai discountedPrice mesmo sem cupom (desconto direto)', async () => {
    generateObjectMock.mockResolvedValue({
      object: {
        isMercadoLivrePromo: true,
        link: 'https://www.mercadolivre.com.br/produto/p/MLB555',
        coupon: null,
        discountedPrice: 129.9,
      },
    });

    const result = await extractPromo(
      'Produto Y\nDe R$179,90 por R$129,90\nhttps://www.mercadolivre.com.br/produto/p/MLB555',
    );

    expect(result.coupon).toBeNull();
    expect(result.discountedPrice).toBe(129.9);
  });
});
