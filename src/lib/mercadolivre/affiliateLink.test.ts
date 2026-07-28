import { afterEach, describe, expect, it, vi } from 'vitest';

const { runCommandMock, writeFilesMock, getOrCreateMock } = vi.hoisted(() => {
  const runCommandMock = vi.fn();
  const writeFilesMock = vi.fn();
  const getOrCreateMock = vi.fn().mockResolvedValue({
    writeFiles: writeFilesMock,
    runCommand: runCommandMock,
  });
  return { runCommandMock, writeFilesMock, getOrCreateMock };
});

vi.mock('@vercel/sandbox', () => ({
  Sandbox: { getOrCreate: getOrCreateMock },
}));

vi.mock('../session/sessionStore', () => ({
  loadSession: vi.fn().mockResolvedValue(Buffer.from('{"cookies":[]}')),
}));

import { fetchProductAndAffiliateLink } from './affiliateLink';

describe('fetchProductAndAffiliateLink', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('retorna produto e link de afiliado quando o script termina com sucesso', async () => {
    runCommandMock.mockResolvedValue({
      exitCode: 0,
      stdout: async () =>
        `${JSON.stringify({
          title: 'Fone de Ouvido Bluetooth XYZ',
          price: 149.9,
          imageUrl: 'https://http2.mlstatic.com/img.jpg',
          affiliateLink: 'https://meli.la/abc123',
        })}\n`,
      stderr: async () => '',
    });

    const result = await fetchProductAndAffiliateLink('https://mercadolivre.com.br/MLB123');

    expect(result).toEqual({
      product: {
        title: 'Fone de Ouvido Bluetooth XYZ',
        price: 149.9,
        imageUrl: 'https://http2.mlstatic.com/img.jpg',
      },
      affiliateLink: 'https://meli.la/abc123',
    });
    expect(writeFilesMock).toHaveBeenCalled();
    expect(runCommandMock).toHaveBeenCalledWith(
      expect.objectContaining({
        cmd: 'node',
        args: ['generate-link.mjs', 'https://mercadolivre.com.br/MLB123'],
      }),
    );
  });

  it('lança SessionExpiredError quando o script reporta SESSION_EXPIRED no stderr', async () => {
    runCommandMock.mockResolvedValue({
      exitCode: 1,
      stdout: async () => '',
      stderr: async () => 'SESSION_EXPIRED',
    });

    await expect(
      fetchProductAndAffiliateLink('https://mercadolivre.com.br/MLB123'),
    ).rejects.toThrow('SESSION_EXPIRED');
  });

  it('lança ProductNotFoundError quando o script reporta PRODUCT_NOT_FOUND no stderr', async () => {
    runCommandMock.mockResolvedValue({
      exitCode: 1,
      stdout: async () => '',
      stderr: async () => 'PRODUCT_NOT_FOUND (title=null, price=null, imageUrl=null)',
    });

    await expect(
      fetchProductAndAffiliateLink('https://mercadolivre.com.br/MLB123'),
    ).rejects.toThrow('Produto não encontrado');
  });

  it('lança InvalidLinkError quando o script reporta LINK_NOT_MERCADOLIVRE no stderr', async () => {
    runCommandMock.mockResolvedValue({
      exitCode: 1,
      stdout: async () => '',
      stderr: async () => 'LINK_NOT_MERCADOLIVRE (resolvido para: https://exemplo.com/outra-coisa)',
    });

    await expect(
      fetchProductAndAffiliateLink('https://go.promozone.ai/mercadolivre/PwQ6x6'),
    ).rejects.toThrow('Link não leva a uma página do Mercado Livre');
  });

  it('lança erro genérico quando o script falha por outro motivo', async () => {
    runCommandMock.mockResolvedValue({
      exitCode: 1,
      stdout: async () => '',
      stderr: async () => 'TimeoutError: locator not found',
    });

    await expect(
      fetchProductAndAffiliateLink('https://mercadolivre.com.br/MLB123'),
    ).rejects.toThrow('Falha ao gerar link de afiliado');
  });

  it('lança erro quando a saída não é um JSON válido', async () => {
    runCommandMock.mockResolvedValue({
      exitCode: 0,
      stdout: async () => 'not json',
      stderr: async () => '',
    });

    await expect(
      fetchProductAndAffiliateLink('https://mercadolivre.com.br/MLB123'),
    ).rejects.toThrow('Saída inesperada do script de afiliado');
  });
});
