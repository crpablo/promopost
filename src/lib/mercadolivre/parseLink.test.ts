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
});
