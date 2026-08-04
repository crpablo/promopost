import { describe, expect, it } from 'vitest';
import { buildCouponArticleText, buildCouponCaption } from './couponTemplate';

const FULL_DETAILS = {
  coupon: 'LIVROSJOGOSRELAMPAGO',
  affiliateLink: 'https://mercadolivre.com/sec/xyz789',
  discountPercent: 20,
  minPurchaseValue: 59,
  maxDiscountValue: 30,
};

describe('buildCouponCaption', () => {
  it('monta a legenda completa quando todos os detalhes de desconto estão presentes', () => {
    const text = buildCouponCaption(FULL_DETAILS);
    expect(text).toBe(
      '🎟️ Cupom Mercado Livre: LIVROSJOGOSRELAMPAGO\n\n🔥 20% OFF em compras acima de R$59,00\n\n💰 Desconto máximo de R$30,00\n\n🔗 Ative: https://mercadolivre.com/sec/xyz789\n\n#promocao #cupom #mercadolivre',
    );
  });

  it('omite as linhas de desconto quando discountPercent, minPurchaseValue e maxDiscountValue estão ausentes', () => {
    const text = buildCouponCaption({
      coupon: 'LIVROSJOGOSRELAMPAGO',
      affiliateLink: 'https://mercadolivre.com/sec/xyz789',
    });
    expect(text).toBe(
      '🎟️ Cupom Mercado Livre: LIVROSJOGOSRELAMPAGO\n\n🔗 Ative: https://mercadolivre.com/sec/xyz789\n\n#promocao #cupom #mercadolivre',
    );
  });

  it('mostra o percentual sem "em compras acima de" quando minPurchaseValue está ausente', () => {
    const text = buildCouponCaption({
      coupon: 'LIVROSJOGOSRELAMPAGO',
      affiliateLink: 'https://mercadolivre.com/sec/xyz789',
      discountPercent: 20,
    });
    expect(text).toBe(
      '🎟️ Cupom Mercado Livre: LIVROSJOGOSRELAMPAGO\n\n🔥 20% OFF\n\n🔗 Ative: https://mercadolivre.com/sec/xyz789\n\n#promocao #cupom #mercadolivre',
    );
  });

  it('mostra o valor mínimo de compra numa linha própria quando discountPercent está ausente', () => {
    const text = buildCouponCaption({
      coupon: 'LIVROSJOGOSRELAMPAGO',
      affiliateLink: 'https://mercadolivre.com/sec/xyz789',
      minPurchaseValue: 200,
    });
    expect(text).toBe(
      '🎟️ Cupom Mercado Livre: LIVROSJOGOSRELAMPAGO\n\n📦 Em compras acima de R$200,00\n\n🔗 Ative: https://mercadolivre.com/sec/xyz789\n\n#promocao #cupom #mercadolivre',
    );
  });
});

describe('buildCouponArticleText', () => {
  it('monta título e corpo completos quando todos os detalhes de desconto estão presentes', () => {
    const result = buildCouponArticleText(FULL_DETAILS);
    expect(result.title).toBe('Cupom Mercado Livre: 20% OFF em compras acima de R$59,00');
    expect(result.body).toBe(
      'Cupom: <strong>LIVROSJOGOSRELAMPAGO</strong><br><br>20% OFF em compras acima de R$59,00<br><br>Desconto máximo de R$30,00<br><br><a href="https://mercadolivre.com/sec/xyz789">Ative o cupom</a>',
    );
  });

  it('usa o código do cupom como título quando discountPercent está ausente', () => {
    const result = buildCouponArticleText({
      coupon: 'LIVROSJOGOSRELAMPAGO',
      affiliateLink: 'https://mercadolivre.com/sec/xyz789',
    });
    expect(result.title).toBe('Cupom Mercado Livre: LIVROSJOGOSRELAMPAGO');
    expect(result.body).toBe(
      'Cupom: <strong>LIVROSJOGOSRELAMPAGO</strong><br><br><a href="https://mercadolivre.com/sec/xyz789">Ative o cupom</a>',
    );
  });

  it('escapa HTML no código do cupom e no link de afiliado', () => {
    const result = buildCouponArticleText({
      coupon: '<script>X</script>',
      affiliateLink: 'https://mercadolivre.com/sec/xyz789?a=1&b=2',
    });
    expect(result.body).toContain('&lt;script&gt;X&lt;/script&gt;');
    expect(result.body).toContain('https://mercadolivre.com/sec/xyz789?a=1&amp;b=2');
  });

  it('mostra o valor mínimo de compra no corpo do artigo quando discountPercent está ausente', () => {
    const result = buildCouponArticleText({
      coupon: 'LIVROSJOGOSRELAMPAGO',
      affiliateLink: 'https://mercadolivre.com/sec/xyz789',
      minPurchaseValue: 200,
    });
    expect(result.body).toBe(
      'Cupom: <strong>LIVROSJOGOSRELAMPAGO</strong><br><br>Em compras acima de R$200,00<br><br><a href="https://mercadolivre.com/sec/xyz789">Ative o cupom</a>',
    );
  });
});
