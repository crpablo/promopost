import { describe, expect, it } from 'vitest';
import { parseItemId } from './parseLink';

describe('parseItemId', () => {
  it('aceita um link http(s) válido do Mercado Livre', () => {
    const link = 'https://www.mercadolivre.com.br/produto-exemplo/p/MLB12345678';
    expect(parseItemId(link)).toBe(link);
  });

  it('aceita um link http(s) válido de outro domínio (pode ser encurtador que resolve pro ML depois)', () => {
    const link = 'https://go.promozone.ai/mercadolivre/PwQ6x6';
    expect(parseItemId(link)).toBe(link);
  });

  it('retorna null para string vazia', () => {
    expect(parseItemId('')).toBeNull();
  });

  it('retorna null para string que não é uma URL', () => {
    expect(parseItemId('não é um link')).toBeNull();
  });

  it('retorna null para protocolo que não é http nem https', () => {
    expect(parseItemId('ftp://exemplo.com/arquivo')).toBeNull();
  });
});
