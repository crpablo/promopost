import { describe, expect, it } from 'vitest';
import { buildSocialCaption } from './caption';

describe('buildSocialCaption', () => {
  it('monta a legenda com preço único e hashtags, sem HTML', () => {
    const text = buildSocialCaption(
      { title: 'Fone de Ouvido Bluetooth XYZ', price: 149.9, imageUrl: 'https://x.com/img.jpg' },
      'https://meli.la/abc123',
    );
    expect(text).toBe(
      '🏷️ R$149,90\n\n🔗 Confira: https://meli.la/abc123\n\n#promocao #oferta #mercadolivre #desconto',
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
      '🔥 De R$149,90 por R$89,90\n\n🎟️ Cupom: PROMO10\n\n🔗 Confira: https://meli.la/abc123\n\n#promocao #oferta #mercadolivre #desconto',
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
      '🔥 De R$200,00 por R$150,00\n\n🔗 Confira: https://meli.la/xyz\n\n#promocao #oferta #mercadolivre #desconto',
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
      '🏷️ R$200,00\n\n🔗 Confira: https://meli.la/xyz\n\n#promocao #oferta #mercadolivre #desconto',
    );
  });
});
