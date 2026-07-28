import { describe, expect, it } from 'vitest';
import { parseItemId } from './parseLink';

describe('parseItemId', () => {
  it('extrai o ID de um link com formato produto.mercadolivre.com.br', () => {
    const link = 'https://produto.mercadolivre.com.br/MLB-1234567890-produto-exemplo-_JM';
    expect(parseItemId(link)).toBe('MLB1234567890');
  });

  it('extrai o ID de um link com formato /p/', () => {
    const link = 'https://www.mercadolivre.com.br/produto-exemplo/p/MLB12345678';
    expect(parseItemId(link)).toBe('MLB12345678');
  });

  it('extrai o ID sem hífen', () => {
    const link = 'https://www.mercadolivre.com.br/MLB1234567890';
    expect(parseItemId(link)).toBe('MLB1234567890');
  });

  it('retorna null para link que não é do Mercado Livre', () => {
    const link = 'https://www.shopee.com.br/produto-x';
    expect(parseItemId(link)).toBeNull();
  });

  it('retorna null para string vazia', () => {
    expect(parseItemId('')).toBeNull();
  });

  it('retorna null para URL de outro domínio com substring MLB... incidental', () => {
    const link = 'https://exemplo.com/track?ref=MLB123456';
    expect(parseItemId(link)).toBeNull();
  });

  it('extrai o ID de um link de produto usado com formato /up/MLBU...', () => {
    const link = 'https://www.mercadolivre.com.br/apple-iphone-16-pro-256-gb/up/MLBU4445659112';
    expect(parseItemId(link)).toBe('MLBU4445659112');
  });

  it('extrai o ID ignorando parâmetros de rastreio e fragmento na URL', () => {
    const link =
      'https://www.mercadolivre.com.br/apple-iphone-14-pro-max-128-gb-prateado/p/MLB19615338?utm_source=whatsapp#polycard_client=search-desktop&wid=MLB4615232143&sid=search';
    expect(parseItemId(link)).toBe('MLB19615338');
  });
});
