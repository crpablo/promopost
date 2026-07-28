import { describe, expect, it } from 'vitest';
import { buildPostText } from './template';

describe('buildPostText', () => {
  it('monta o HTML com preço em negrito e o link do produto clicável', () => {
    const text = buildPostText(
      { title: 'Fone de Ouvido Bluetooth XYZ', price: 149.9, imageUrl: 'https://x.com/img.jpg' },
      'https://meli.la/abc123',
    );
    expect(text).toBe(
      'Fone de Ouvido Bluetooth XYZ por <strong>R$149,90</strong> — confira: <a href="https://meli.la/abc123">https://meli.la/abc123</a>',
    );
  });

  it('formata preço inteiro com duas casas decimais', () => {
    const text = buildPostText(
      { title: 'Produto X', price: 200, imageUrl: 'https://x.com/img.jpg' },
      'https://meli.la/xyz',
    );
    expect(text).toContain('<strong>R$200,00</strong>');
  });

  it('escapa caracteres especiais de HTML no título do produto', () => {
    const text = buildPostText(
      { title: 'Produto <script>alert(1)</script> & cia', price: 50, imageUrl: 'https://x.com/img.jpg' },
      'https://meli.la/xyz',
    );
    expect(text).toContain('Produto &lt;script&gt;alert(1)&lt;/script&gt; &amp; cia');
    expect(text).not.toContain('<script>');
  });

  it('monta o HTML com preço de/por riscado e cupom quando discountedPrice é informado', () => {
    const text = buildPostText(
      { title: 'Fone de Ouvido Bluetooth XYZ', price: 149.9, imageUrl: 'https://x.com/img.jpg' },
      'https://meli.la/abc123',
      'PROMO10',
      89.9,
    );
    expect(text).toBe(
      'Fone de Ouvido Bluetooth XYZ de <s>R$149,90</s> por <strong>R$89,90</strong> com o cupom <strong>PROMO10</strong> — confira: <a href="https://meli.la/abc123">https://meli.la/abc123</a>',
    );
  });

  it('monta preço de/por sem cupom quando discountedPrice vem sem coupon', () => {
    const text = buildPostText(
      { title: 'Produto X', price: 200, imageUrl: 'https://x.com/img.jpg' },
      'https://meli.la/xyz',
      undefined,
      150,
    );
    expect(text).toBe(
      'Produto X de <s>R$200,00</s> por <strong>R$150,00</strong> — confira: <a href="https://meli.la/xyz">https://meli.la/xyz</a>',
    );
  });
});
