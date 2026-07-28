import { describe, expect, it } from 'vitest';
import { buildPostText } from './template';

describe('buildPostText', () => {
  it('monta o texto no formato [TÍTULO] por R$[PREÇO] — confira: [LINK]', () => {
    const text = buildPostText(
      { title: 'Fone de Ouvido Bluetooth XYZ', price: 149.9, imageUrl: 'https://x.com/img.jpg' },
      'https://mercadolivre.com/sec/abc123',
    );
    expect(text).toBe(
      'Fone de Ouvido Bluetooth XYZ por R$149,90 — confira: https://mercadolivre.com/sec/abc123',
    );
  });

  it('formata preço inteiro com duas casas decimais', () => {
    const text = buildPostText(
      { title: 'Produto X', price: 200, imageUrl: 'https://x.com/img.jpg' },
      'https://mercadolivre.com/sec/xyz',
    );
    expect(text).toContain('R$200,00');
  });
});
