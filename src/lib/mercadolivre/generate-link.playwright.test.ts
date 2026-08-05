import { describe, expect, it } from 'vitest';
// O script .mjs roda fora do build do Next.js (é copiado e executado direto
// na Vercel Sandbox — ver comentário no topo do .mjs) e o tsconfig do projeto
// tem `allowJs: false`, então o TypeScript não enxerga o tipo do módulo .mjs
// ao importá-lo aqui (TS7016). Uma declaração `declare module` local não
// resolve — TS recusa reaugmentar um módulo relativo já resolvido como
// untyped (TS2665). @ts-expect-error só pra satisfazer `tsc --noEmit`;
// em runtime (Vitest/esbuild) o import funciona normalmente.
// @ts-expect-error TS7016 — módulo .mjs sem declaração de tipos (allowJs: false no tsconfig)
import { buildAmazonAffiliateLink, parseBrazilianPrice } from './generate-link.playwright.mjs';

describe('parseBrazilianPrice', () => {
  it('converte texto formatado em reais pra número', () => {
    expect(parseBrazilianPrice('R$ 1.234,56')).toBe(1234.56);
  });

  it('converte preço sem separador de milhar', () => {
    expect(parseBrazilianPrice('R$ 99,90')).toBe(99.9);
  });

  it('lida com espaço não-quebrável entre "R$" e o valor', () => {
    expect(parseBrazilianPrice('R$ 149,00')).toBe(149);
  });

  it('retorna NaN quando o texto é null', () => {
    expect(parseBrazilianPrice(null)).toBeNaN();
  });

  it('retorna NaN quando o texto não tem número nenhum', () => {
    expect(parseBrazilianPrice('indisponível')).toBeNaN();
  });
});

describe('buildAmazonAffiliateLink', () => {
  it('adiciona o parâmetro tag numa URL sem query string', () => {
    const result = buildAmazonAffiliateLink('https://www.amazon.com.br/dp/B08XYZ', 'crpablo0d-20');
    expect(result).toBe('https://www.amazon.com.br/dp/B08XYZ?tag=crpablo0d-20');
  });

  it('adiciona o parâmetro tag preservando outros parâmetros existentes', () => {
    const result = buildAmazonAffiliateLink('https://www.amazon.com.br/dp/B08XYZ?ref=abc', 'crpablo0d-20');
    expect(result).toBe('https://www.amazon.com.br/dp/B08XYZ?ref=abc&tag=crpablo0d-20');
  });

  it('sobrescreve um parâmetro tag já existente em vez de duplicar', () => {
    const result = buildAmazonAffiliateLink('https://www.amazon.com.br/dp/B08XYZ?tag=outro-20', 'crpablo0d-20');
    expect(result).toBe('https://www.amazon.com.br/dp/B08XYZ?tag=crpablo0d-20');
  });
});

