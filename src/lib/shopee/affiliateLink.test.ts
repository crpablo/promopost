import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildShopeeAffiliateLink, calculateShopeeSignature, isShopeeLink } from './affiliateLink';

describe('isShopeeLink', () => {
  it('reconhece o domínio apex shopee.com.br', () => {
    expect(isShopeeLink('https://shopee.com.br/produto-x-i.123.456')).toBe(true);
  });

  it('reconhece o subdomínio de link curto s.shopee.com.br (formato usado nas mensagens)', () => {
    expect(isShopeeLink('https://s.shopee.com.br/3AbCdEfG')).toBe(true);
  });

  it('rejeita outros marketplaces', () => {
    expect(isShopeeLink('https://www.mercadolivre.com.br/produto/p/MLB1')).toBe(false);
    expect(isShopeeLink('https://www.magazineluiza.com.br/produto-x/p/abc123/')).toBe(false);
  });

  it('retorna false pra URL malformada em vez de lançar', () => {
    expect(isShopeeLink('não é uma url')).toBe(false);
  });
});

describe('calculateShopeeSignature', () => {
  it('calcula SHA256 hex de appId + timestamp + payload + secret', async () => {
    const { createHash } = await import('node:crypto');
    const expected = createHash('sha256')
      .update('app1' + '1700000000' + '{"a":1}' + 'secret123')
      .digest('hex');
    const result = calculateShopeeSignature('app1', 1700000000, '{"a":1}', 'secret123');
    expect(result).toBe(expected);
    expect(result).toMatch(/^[0-9a-f]{64}$/);
  });

  it('produz assinaturas diferentes pra payloads diferentes (sensibilidade ao conteúdo)', () => {
    const sig1 = calculateShopeeSignature('app1', 1700000000, '{"a":1}', 'secret123');
    const sig2 = calculateShopeeSignature('app1', 1700000000, '{"a":2}', 'secret123');
    expect(sig1).not.toBe(sig2);
  });
});

describe('buildShopeeAffiliateLink', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function mockFetchSequence(resolvedUrl: string, graphqlResponse: { ok: boolean; body: unknown }) {
    const fetchMock = vi.fn();
    fetchMock.mockResolvedValueOnce({ url: resolvedUrl });
    fetchMock.mockResolvedValueOnce({
      ok: graphqlResponse.ok,
      status: graphqlResponse.ok ? 200 : 500,
      json: async () => graphqlResponse.body,
    });
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  }

  it('resolve o link curto e usa a URL resolvida (não a original) como originUrl na chamada GraphQL', async () => {
    const fetchMock = mockFetchSequence('https://shopee.com.br/produto-real-i.123.456', {
      ok: true,
      body: { data: { generateShortLink: { shortLink: 'https://s.shopee.com.br/novo-link' } } },
    });

    const result = await buildShopeeAffiliateLink('https://s.shopee.com.br/3AbCdEfG', 'app1', 'secret123');

    expect(result).toBe('https://s.shopee.com.br/novo-link');
    expect(fetchMock).toHaveBeenNthCalledWith(1, 'https://s.shopee.com.br/3AbCdEfG', { redirect: 'follow' });
    const secondCallBody = JSON.parse((fetchMock.mock.calls[1][1] as RequestInit).body as string);
    expect(secondCallBody.variables.input.originUrl).toBe('https://shopee.com.br/produto-real-i.123.456');
  });

  it('lança SHOPEE_API_ERROR quando a API GraphQL retorna erros', async () => {
    mockFetchSequence('https://shopee.com.br/produto-real', {
      ok: true,
      body: { errors: [{ message: 'invalid signature' }] },
    });

    await expect(
      buildShopeeAffiliateLink('https://s.shopee.com.br/x', 'app1', 'secret123'),
    ).rejects.toThrow('SHOPEE_API_ERROR');
  });

  it('lança SHOPEE_API_ERROR quando o fetch da chamada GraphQL falha (rede/timeout)', async () => {
    const fetchMock = vi.fn();
    fetchMock.mockResolvedValueOnce({ url: 'https://shopee.com.br/produto-real' });
    fetchMock.mockRejectedValueOnce(new TypeError('fetch failed'));
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      buildShopeeAffiliateLink('https://s.shopee.com.br/x', 'app1', 'secret123'),
    ).rejects.toThrow('SHOPEE_API_ERROR');
  });
});
