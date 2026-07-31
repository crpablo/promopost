import { describe, expect, it } from 'vitest';
import { buildSocialCaption } from './caption';

describe('buildSocialCaption', () => {
  it('monta a legenda com preço único e hashtags, sem HTML', () => {
    const text = buildSocialCaption(
      { title: 'Fone de Ouvido Bluetooth XYZ', price: 149.9, imageUrl: 'https://x.com/img.jpg' },
      'https://meli.la/abc123',
    );
    expect(text).toBe(
      'Fone de Ouvido Bluetooth XYZ\n\n🏷️ R$149,90\n\n🔗 Confira: https://meli.la/abc123 (também no link da bio)\n\n#promocao #oferta #mercadolivre #desconto',
    );
  });

  it('monta a legenda com preço de/por e cupom quando discountedPrice é informado', () => {
    const text = buildSocialCaption(
      { title: 'Fone de Ouvido Bluetooth XYZ', price: 149.9, imageUrl: 'https://x.com/img.jpg' },
      'https://meli.la/abc123',
      'PROMO10',
      89.9,
    );
    expect(text).toBe(
      'Fone de Ouvido Bluetooth XYZ\n\n🔥 De R$149,90 por R$89,90\n\n🎟️ Cupom: PROMO10\n\n🔗 Confira: https://meli.la/abc123 (também no link da bio)\n\n#promocao #oferta #mercadolivre #desconto',
    );
  });

  it('monta preço de/por sem cupom quando discountedPrice vem sem coupon', () => {
    const text = buildSocialCaption(
      { title: 'Produto X', price: 200, imageUrl: 'https://x.com/img.jpg' },
      'https://meli.la/xyz',
      undefined,
      150,
    );
    expect(text).toBe(
      'Produto X\n\n🔥 De R$200,00 por R$150,00\n\n🔗 Confira: https://meli.la/xyz (também no link da bio)\n\n#promocao #oferta #mercadolivre #desconto',
    );
  });

  it('cai no caminho de preço único quando discountedPrice não é um número (defesa contra caller malformado)', () => {
    const text = buildSocialCaption(
      { title: 'Produto X', price: 200, imageUrl: 'https://x.com/img.jpg' },
      'https://meli.la/xyz',
      undefined,
      null as unknown as number | undefined,
    );
    expect(text).toBe(
      'Produto X\n\n🏷️ R$200,00\n\n🔗 Confira: https://meli.la/xyz (também no link da bio)\n\n#promocao #oferta #mercadolivre #desconto',
    );
  });

  it('usa #shopee na legenda quando o produto vem da Shopee', () => {
    const text = buildSocialCaption(
      { title: 'Produto Y', price: 79.9, imageUrl: 'https://x.com/img.jpg', marketplace: 'shopee' },
      'https://s.shopee.com.br/abc123',
    );
    expect(text).toBe(
      'Produto Y\n\n🏷️ R$79,90\n\n🔗 Confira: https://s.shopee.com.br/abc123 (também no link da bio)\n\n#promocao #oferta #shopee #desconto',
    );
  });

  it('usa #mercadolivre na legenda quando o produto não informa marketplace (default)', () => {
    const text = buildSocialCaption(
      { title: 'Produto Z', price: 50, imageUrl: 'https://x.com/img.jpg' },
      'https://meli.la/xyz',
    );
    expect(text).toBe(
      'Produto Z\n\n🏷️ R$50,00\n\n🔗 Confira: https://meli.la/xyz (também no link da bio)\n\n#promocao #oferta #mercadolivre #desconto',
    );
  });
});
