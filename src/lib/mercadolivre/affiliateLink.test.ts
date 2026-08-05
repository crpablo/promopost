import { afterEach, describe, expect, it, vi } from 'vitest';

const { execFileMock } = vi.hoisted(() => ({
  execFileMock: vi.fn(),
}));

vi.mock('node:child_process', () => ({
  execFile: execFileMock,
}));

vi.mock('../session/sessionStore', () => ({
  loadSession: vi.fn().mockResolvedValue(Buffer.from('{"cookies":[]}')),
}));

import { fetchProductAndAffiliateLink } from './affiliateLink';

function mockExecFileSuccess(stdout: string) {
  execFileMock.mockImplementation((_cmd, _args, _options, callback) => {
    callback(null, stdout, '');
  });
}

function mockExecFileFailure(stderr: string) {
  execFileMock.mockImplementation((_cmd, _args, _options, callback) => {
    const err = Object.assign(new Error('Command failed'), { stderr });
    callback(err, '', stderr);
  });
}

describe('fetchProductAndAffiliateLink', () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
  });

  it('retorna produto e link de afiliado quando o script termina com sucesso', async () => {
    mockExecFileSuccess(
      `${JSON.stringify({
        title: 'Fone de Ouvido Bluetooth XYZ',
        price: 149.9,
        imageUrl: 'https://http2.mlstatic.com/img.jpg',
        marketplace: 'mercadolivre',
        affiliateLink: 'https://meli.la/abc123',
      })}\n`,
    );

    const result = await fetchProductAndAffiliateLink('https://mercadolivre.com.br/MLB123');

    expect(result).toEqual({
      product: {
        title: 'Fone de Ouvido Bluetooth XYZ',
        price: 149.9,
        imageUrl: 'https://http2.mlstatic.com/img.jpg',
        marketplace: 'mercadolivre',
      },
      affiliateLink: 'https://meli.la/abc123',
    });
    expect(execFileMock).toHaveBeenCalledWith(
      'node',
      expect.arrayContaining([expect.stringContaining('generate-link.playwright.mjs'), 'https://mercadolivre.com.br/MLB123']),
      expect.objectContaining({
        env: expect.objectContaining({ ML_SESSION_PATH: expect.any(String) }),
      }),
      expect.any(Function),
    );
  });

  it('lança SessionExpiredError quando o script reporta SESSION_EXPIRED no stderr', async () => {
    mockExecFileFailure('SESSION_EXPIRED');

    await expect(
      fetchProductAndAffiliateLink('https://mercadolivre.com.br/MLB123'),
    ).rejects.toThrow('SESSION_EXPIRED');
  });

  it('lança ProductNotFoundError quando o script reporta PRODUCT_NOT_FOUND no stderr', async () => {
    mockExecFileFailure('PRODUCT_NOT_FOUND (title=null, price=null, imageUrl=null)');

    await expect(
      fetchProductAndAffiliateLink('https://mercadolivre.com.br/MLB123'),
    ).rejects.toThrow('Produto não encontrado');
  });

  it('lança InvalidLinkError quando o script reporta MARKETPLACE_NOT_SUPPORTED no stderr', async () => {
    mockExecFileFailure('MARKETPLACE_NOT_SUPPORTED (resolvido para: https://exemplo.com/outra-coisa)');

    await expect(
      fetchProductAndAffiliateLink('https://go.promozone.ai/mercadolivre/PwQ6x6'),
    ).rejects.toThrow('Link não leva a um marketplace suportado');
  });

  it('lança ListCouponError com o link de afiliado quando o script reporta isListCoupon:true (cupom de lista)', async () => {
    mockExecFileSuccess(
      `${JSON.stringify({
        marketplace: 'mercadolivre',
        affiliateLink: 'https://mercadolivre.com/sec/xyz789',
        isListCoupon: true,
      })}\n`,
    );

    await expect(
      fetchProductAndAffiliateLink('https://www.mercadolivre.com.br/social/promozonevip/lists'),
    ).rejects.toMatchObject({
      name: 'ListCouponError',
      affiliateLink: 'https://mercadolivre.com/sec/xyz789',
    });
  });

  it('lança erro genérico quando isListCoupon:true mas affiliateLink está ausente ou inválido', async () => {
    mockExecFileSuccess(
      `${JSON.stringify({
        marketplace: 'mercadolivre',
        isListCoupon: true,
      })}\n`,
    );

    await expect(
      fetchProductAndAffiliateLink('https://www.mercadolivre.com.br/social/promozonevip/lists'),
    ).rejects.toThrow('Saída inesperada do script de afiliado');
  });

  it('lança erro genérico quando o script falha por outro motivo', async () => {
    mockExecFileFailure('TimeoutError: locator not found');

    await expect(
      fetchProductAndAffiliateLink('https://mercadolivre.com.br/MLB123'),
    ).rejects.toThrow('Falha ao gerar link de afiliado');
  });

  it('lança erro quando a saída não é um JSON válido', async () => {
    mockExecFileSuccess('not json');

    await expect(
      fetchProductAndAffiliateLink('https://mercadolivre.com.br/MLB123'),
    ).rejects.toThrow('Saída inesperada do script de afiliado');
  });

  it('retorna produto da Amazon com marketplace correto quando o script termina com sucesso', async () => {
    mockExecFileSuccess(
      `${JSON.stringify({
        title: 'Fone Bluetooth Amazon',
        price: 129.9,
        imageUrl: 'https://m.media-amazon.com/images/I/abc.jpg',
        marketplace: 'amazon',
        affiliateLink: 'https://www.amazon.com.br/dp/B08XYZ?tag=crpablo0d-20',
      })}\n`,
    );

    const result = await fetchProductAndAffiliateLink('https://www.amazon.com.br/dp/B08XYZ');

    expect(result.product.marketplace).toBe('amazon');
  });

  it('lança erro quando o script reporta AMAZON_CREDENTIALS_MISSING no stderr', async () => {
    mockExecFileFailure('AMAZON_CREDENTIALS_MISSING');

    await expect(
      fetchProductAndAffiliateLink('https://www.amazon.com.br/dp/B08XYZ'),
    ).rejects.toThrow('Variáveis de ambiente da Amazon ausentes');
  });

  it('passa AMAZON_ASSOCIATE_TAG como env var pro processo filho', async () => {
    vi.stubEnv('AMAZON_ASSOCIATE_TAG', 'crpablo0d-20');
    mockExecFileSuccess(
      `${JSON.stringify({
        title: 'Produto',
        price: 10,
        imageUrl: 'https://m.media-amazon.com/images/I/x.jpg',
        marketplace: 'amazon',
        affiliateLink: 'https://www.amazon.com.br/dp/X?tag=crpablo0d-20',
      })}\n`,
    );

    await fetchProductAndAffiliateLink('https://www.amazon.com.br/dp/X');

    expect(execFileMock).toHaveBeenCalledWith(
      'node',
      expect.any(Array),
      expect.objectContaining({
        env: expect.objectContaining({ AMAZON_ASSOCIATE_TAG: 'crpablo0d-20' }),
      }),
      expect.any(Function),
    );
  });

});
