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

  it('reconhece o encurtador go.promozone.ai com prefixo /shopee/ (formato usado atualmente no canal)', () => {
    expect(isShopeeLink('https://go.promozone.ai/shopee/i5xwnv')).toBe(true);
  });

  it('rejeita go.promozone.ai com prefixo de outro marketplace', () => {
    expect(isShopeeLink('https://go.promozone.ai/mercadolivre/281iL6')).toBe(false);
    expect(isShopeeLink('https://go.promozone.ai/magalu/DhB9GA')).toBe(false);
    expect(isShopeeLink('https://go.promozone.ai/amz/9BCkIs')).toBe(false);
  });

  it('rejeita go.promozone.ai sem nenhum prefixo de marketplace reconhecido', () => {
    expect(isShopeeLink('https://go.promozone.ai/')).toBe(false);
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

  // go.promozone.ai/shopee/<codigo> não faz redirect HTTP (a página faz
  // window.location.replace via JS, um fetch simples não segue isso) — por
  // isso precisa de um passo extra: resolver o código via API própria do
  // promozone.ai (achada no bundle JS da SPA, endpoint hardcoded em
  // VITE_RESOLVE_API_BASE_URL) antes de seguir o fluxo normal de redirect.
  it('resolve o encurtador go.promozone.ai via API própria antes de seguir o fluxo normal', async () => {
    const fetchMock = vi.fn();
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ destinationUrl: 'https://s.shopee.com.br/3B7HQY8QPN' }),
    });
    fetchMock.mockResolvedValueOnce({ url: 'https://shopee.com.br/produto-real-i.789.012' });
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ data: { generateShortLink: { shortLink: 'https://s.shopee.com.br/novo-link' } } }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await buildShopeeAffiliateLink('https://go.promozone.ai/shopee/t8o87K', 'app1', 'secret123');

    expect(result).toBe('https://s.shopee.com.br/novo-link');
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      'https://link-shortener-501307668672.southamerica-east1.run.app/resolve/t8o87K',
      expect.anything(),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(2, 'https://s.shopee.com.br/3B7HQY8QPN', { redirect: 'follow' });
    const graphqlBody = JSON.parse((fetchMock.mock.calls[2][1] as RequestInit).body as string);
    expect(graphqlBody.variables.input.originUrl).toBe('https://shopee.com.br/produto-real-i.789.012');
  });

  it('não chama a API de resolve do promozone quando o link já é do encurtador oficial da Shopee', async () => {
    const fetchMock = mockFetchSequence('https://shopee.com.br/produto-real', {
      ok: true,
      body: { data: { generateShortLink: { shortLink: 'https://s.shopee.com.br/y' } } },
    });

    await buildShopeeAffiliateLink('https://s.shopee.com.br/x', 'app1', 'secret123');

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('lança SHOPEE_REDIRECT_ERROR quando a API de resolve do promozone não retorna destinationUrl', async () => {
    const fetchMock = vi.fn();
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({}) });
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      buildShopeeAffiliateLink('https://go.promozone.ai/shopee/xyz', 'app1', 'secret123'),
    ).rejects.toThrow('SHOPEE_REDIRECT_ERROR');
  });

  it('lança SHOPEE_REDIRECT_ERROR quando a API de resolve do promozone responde com erro HTTP', async () => {
    const fetchMock = vi.fn();
    fetchMock.mockResolvedValueOnce({ ok: false, status: 404, json: async () => ({}) });
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      buildShopeeAffiliateLink('https://go.promozone.ai/shopee/xyz', 'app1', 'secret123'),
    ).rejects.toThrow('SHOPEE_REDIRECT_ERROR');
  });
});
