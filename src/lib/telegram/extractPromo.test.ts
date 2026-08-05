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
        isPromo: true,
        link: 'https://www.mercadolivre.com.br/produto/p/MLB123',
        coupon: 'PROMO10',
        discountedPrice: 89.9,
      },
    });

    const result = await extractPromo(
      'Fone Bluetooth XYZ\nDe R$149,90 por R$99,90\nCupom: PROMO10\nhttps://www.mercadolivre.com.br/produto/p/MLB123',
    );

    expect(result).toEqual({
      isPromo: true,
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
        isPromo: true,
        link: 'https://www.mercadolivre.com.br/produto/p/MLB999',
        coupon: null,
        discountedPrice: null,
      },
    });

    const result = await extractPromo('Produto legal https://www.mercadolivre.com.br/produto/p/MLB999');

    expect(result.coupon).toBeNull();
    expect(result.discountedPrice).toBeNull();
  });

  it('retorna isPromo false pra mensagem que não é promo de nenhum marketplace suportado', async () => {
    generateObjectMock.mockResolvedValue({
      object: { isPromo: false, link: null, coupon: null, discountedPrice: null },
    });

    const result = await extractPromo('Bom dia pessoal, tudo certo?');

    expect(result.isPromo).toBe(false);
  });

  it('extrai discountedPrice mesmo sem cupom (desconto direto)', async () => {
    generateObjectMock.mockResolvedValue({
      object: {
        isPromo: true,
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

  it('extrai link, cupom e preço com desconto de uma promo da Shopee', async () => {
    generateObjectMock.mockResolvedValue({
      object: {
        isPromo: true,
        link: 'https://shopee.com.br/product/123456/789',
        coupon: 'SHOPEE20',
        discountedPrice: 45.5,
      },
    });

    const result = await extractPromo(
      'Panela de Pressão Elétrica\nDe R$99,90 por R$45,50\nCupom: SHOPEE20\nhttps://shopee.com.br/product/123456/789',
    );

    expect(result).toEqual({
      isPromo: true,
      link: 'https://shopee.com.br/product/123456/789',
      coupon: 'SHOPEE20',
      discountedPrice: 45.5,
    });
  });

  it('extrai link, cupom e preço com desconto de uma promo da Amazon', async () => {
    generateObjectMock.mockResolvedValue({
      object: {
        isPromo: true,
        link: 'https://www.amazon.com.br/dp/B08XYZ',
        coupon: 'AMAZON15',
        discountedPrice: 79.9,
      },
    });

    const result = await extractPromo(
      'Fritadeira Elétrica Sem Óleo\nDe R$149,90 por R$79,90\nCupom: AMAZON15\nhttps://www.amazon.com.br/dp/B08XYZ',
    );

    expect(result).toEqual({
      isPromo: true,
      link: 'https://www.amazon.com.br/dp/B08XYZ',
      coupon: 'AMAZON15',
      discountedPrice: 79.9,
    });
    expect(generateObjectMock).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: expect.stringContaining('Fritadeira Elétrica Sem Óleo'),
      }),
    );
  });

  it('extrai link e preço com desconto de uma promo do Magalu', async () => {
    generateObjectMock.mockResolvedValue({
      object: {
        isPromo: true,
        link: 'https://www.magazineluiza.com.br/carregador-portatil-turbo-power-bank/p/dkba5b776g/te/accp/',
        coupon: null,
        discountedPrice: 89.9,
      },
    });

    const result = await extractPromo(
      'Carregador Portátil Turbo Power Bank\nDe R$129,90 por R$89,90\nhttps://www.magazineluiza.com.br/carregador-portatil-turbo-power-bank/p/dkba5b776g/te/accp/',
    );

    expect(result).toEqual({
      isPromo: true,
      link: 'https://www.magazineluiza.com.br/carregador-portatil-turbo-power-bank/p/dkba5b776g/te/accp/',
      coupon: null,
      discountedPrice: 89.9,
    });
    expect(generateObjectMock).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: expect.stringContaining('Carregador Portátil Turbo Power Bank'),
      }),
    );
  });

  it('extrai discountPercent, minPurchaseValue e maxDiscountValue de um cupom de loja/categoria inteira', async () => {
    generateObjectMock.mockResolvedValue({
      object: {
        isPromo: true,
        link: 'https://www.mercadolivre.com.br/social/promozonevip/lists',
        coupon: 'LIVROSJOGOSRELAMPAGO',
        discountedPrice: null,
        discountPercent: 20,
        minPurchaseValue: 59,
        maxDiscountValue: 30,
      },
    });

    const result = await extractPromo(
      'NOVO CUPOM MERCADOLIVRE\nLIVROSJOGOSRELAMPAGO 20% OFF em compras acima de R$ 59,00\nDesconto máximo de R$ 30\nAtive pelo link: http://www.mercadolivre.com.br/social/promozonevip/lists',
    );

    expect(result).toEqual({
      isPromo: true,
      link: 'https://www.mercadolivre.com.br/social/promozonevip/lists',
      coupon: 'LIVROSJOGOSRELAMPAGO',
      discountedPrice: null,
      discountPercent: 20,
      minPurchaseValue: 59,
      maxDiscountValue: 30,
    });
  });

  it('retorna discountPercent, minPurchaseValue e maxDiscountValue como null quando a mensagem não menciona esses valores', async () => {
    generateObjectMock.mockResolvedValue({
      object: {
        isPromo: true,
        link: 'https://www.mercadolivre.com.br/produto/p/MLB999',
        coupon: null,
        discountedPrice: null,
        discountPercent: null,
        minPurchaseValue: null,
        maxDiscountValue: null,
      },
    });

    const result = await extractPromo('Produto legal https://www.mercadolivre.com.br/produto/p/MLB999');

    expect(result.discountPercent).toBeNull();
    expect(result.minPurchaseValue).toBeNull();
    expect(result.maxDiscountValue).toBeNull();
  });

  it('extrai title e originalPrice de uma promo do Magalu com preço de/por', async () => {
    generateObjectMock.mockResolvedValue({
      object: {
        isPromo: true,
        link: 'https://www.magazineluiza.com.br/cama-box-king-box-colchao-gazin/divulgador/oferta/229971100/co/cmbx/',
        coupon: null,
        discountedPrice: 2973.49,
        title: 'Gazin Cama Box King Mola',
        originalPrice: 4469.8,
      },
    });

    const result = await extractPromo(
      'ACORDAR RENOVADO É O QUE VOCÊ MERECE TODO DIA\n✅ Gazin Cama Box King Mola\n🔥 DE 4.469,80 | POR 2.973,49\nhttps://www.magazineluiza.com.br/cama-box-king-box-colchao-gazin/divulgador/oferta/229971100/co/cmbx/',
    );

    expect(result).toEqual({
      isPromo: true,
      link: 'https://www.magazineluiza.com.br/cama-box-king-box-colchao-gazin/divulgador/oferta/229971100/co/cmbx/',
      coupon: null,
      discountedPrice: 2973.49,
      title: 'Gazin Cama Box King Mola',
      originalPrice: 4469.8,
    });
  });

  it('extrai title e originalPrice nulos quando a promo não é do Magalu', async () => {
    generateObjectMock.mockResolvedValue({
      object: {
        isPromo: true,
        link: 'https://www.mercadolivre.com.br/produto/p/MLB999',
        coupon: null,
        discountedPrice: null,
        title: null,
        originalPrice: null,
      },
    });

    const result = await extractPromo('Produto legal https://www.mercadolivre.com.br/produto/p/MLB999');

    expect(result.title).toBeNull();
    expect(result.originalPrice).toBeNull();
  });
});
