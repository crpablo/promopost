import { describe, expect, it } from 'vitest';
import { buildMagaluAffiliateLink, isMagaluLink } from './affiliateLink';

describe('isMagaluLink', () => {
  it('reconhece um link do domínio magazineluiza.com.br', () => {
    expect(isMagaluLink('https://www.magazineluiza.com.br/produto-x/p/abc123/')).toBe(true);
  });

  it('rejeita links de outros marketplaces', () => {
    expect(isMagaluLink('https://www.mercadolivre.com.br/produto/p/MLB123')).toBe(false);
    expect(isMagaluLink('https://shopee.com.br/produto-x')).toBe(false);
    expect(isMagaluLink('https://www.amazon.com.br/dp/B08XYZ')).toBe(false);
  });

  it('retorna false pra URL malformada em vez de lançar', () => {
    expect(isMagaluLink('não é uma url')).toBe(false);
  });
});

describe('buildMagaluAffiliateLink', () => {
  it('adiciona todos os parâmetros de afiliado numa URL sem nenhum deles', () => {
    const result = buildMagaluAffiliateLink(
      'https://www.magazineluiza.com.br/produto-x/p/abc123/',
      '3440',
      '5784620',
    );
    expect(result).toBe(
      'https://www.magazineluiza.com.br/produto-x/p/abc123/?partner_id=3440&promoter_id=5784620&utm_source=divulgador&utm_medium=magalu&utm_campaign=5784620',
    );
  });

  it('sobrescreve os parâmetros de afiliado de outro divulgador em vez de manter os dele', () => {
    const result = buildMagaluAffiliateLink(
      'https://www.magazineluiza.com.br/produto-x/p/abc123/?partner_id=9999&promoter_id=1111111&utm_source=divulgador&utm_medium=magalu&utm_campaign=1111111',
      '3440',
      '5784620',
    );
    expect(result).toBe(
      'https://www.magazineluiza.com.br/produto-x/p/abc123/?partner_id=3440&promoter_id=5784620&utm_source=divulgador&utm_medium=magalu&utm_campaign=5784620',
    );
  });

  it('preserva outros parâmetros existentes na URL que não sejam de afiliado', () => {
    const result = buildMagaluAffiliateLink(
      'https://www.magazineluiza.com.br/produto-x/p/abc123/?seller_id=lojasantfl',
      '3440',
      '5784620',
    );
    expect(result).toBe(
      'https://www.magazineluiza.com.br/produto-x/p/abc123/?seller_id=lojasantfl&partner_id=3440&promoter_id=5784620&utm_source=divulgador&utm_medium=magalu&utm_campaign=5784620',
    );
  });
});
