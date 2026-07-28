import { describe, expect, it, vi } from 'vitest';
import {
  InvalidLinkError,
  ProductNotFoundError,
  SessionExpiredError,
  runPipeline,
  type PipelineDeps,
} from './pipeline';

function makeDeps(overrides: Partial<PipelineDeps> = {}): PipelineDeps {
  return {
    parseItemId: vi.fn().mockReturnValue('MLB123'),
    fetchProductAndAffiliateLink: vi.fn().mockResolvedValue({
      product: { title: 'Produto X', price: 99.9, imageUrl: 'https://x.com/img.jpg' },
      affiliateLink: 'https://meli.la/abc',
    }),
    buildPostText: vi.fn().mockReturnValue('Produto X por R$99,90 — confira: https://meli.la/abc'),
    publishArticle: vi
      .fn()
      .mockResolvedValue({ url: 'https://loja.myshopify.com/blogs/noticias/produto-x' }),
    ...overrides,
  };
}

describe('runPipeline', () => {
  it('roda os passos em ordem e retorna a url do post', async () => {
    const deps = makeDeps();

    const result = await runPipeline('https://mercadolivre.com.br/MLB123', deps);

    expect(result).toEqual({ postUrl: 'https://loja.myshopify.com/blogs/noticias/produto-x' });
    expect(deps.fetchProductAndAffiliateLink).toHaveBeenCalledWith('https://mercadolivre.com.br/MLB123');
    expect(deps.publishArticle).toHaveBeenCalledWith(
      'Produto X',
      'Produto X por R$99,90 — confira: https://meli.la/abc',
      'https://x.com/img.jpg',
    );
  });

  it('lança PipelineError no passo link_parse quando o link não é uma URL válida', async () => {
    const deps = makeDeps({ parseItemId: vi.fn().mockReturnValue(null) });

    await expect(runPipeline('não é um link', deps)).rejects.toMatchObject({
      step: 'link_parse',
    });
  });

  it('lança PipelineError no passo link_parse quando o link resolvido não é do Mercado Livre', async () => {
    const deps = makeDeps({
      fetchProductAndAffiliateLink: vi
        .fn()
        .mockRejectedValue(new InvalidLinkError('link não leva a uma página do Mercado Livre')),
    });

    await expect(runPipeline('https://go.promozone.ai/mercadolivre/PwQ6x6', deps)).rejects.toMatchObject({
      step: 'link_parse',
      message: 'link não leva a uma página do Mercado Livre',
    });
  });

  it('lança PipelineError no passo product_fetch quando o produto não é encontrado na página', async () => {
    const deps = makeDeps({
      fetchProductAndAffiliateLink: vi
        .fn()
        .mockRejectedValue(new ProductNotFoundError('produto não encontrado')),
    });

    await expect(runPipeline('https://mercadolivre.com.br/MLB123', deps)).rejects.toMatchObject({
      step: 'product_fetch',
      message: 'produto não encontrado',
    });
  });

  it('lança PipelineError com code SESSION_EXPIRED quando a sessão do ML expirou', async () => {
    const deps = makeDeps({
      fetchProductAndAffiliateLink: vi.fn().mockRejectedValue(new SessionExpiredError()),
    });

    await expect(runPipeline('https://mercadolivre.com.br/MLB123', deps)).rejects.toMatchObject({
      step: 'affiliate_link',
      code: 'SESSION_EXPIRED',
    });
  });

  it('lança PipelineError no passo affiliate_link quando a automação falha por outro motivo', async () => {
    const deps = makeDeps({
      fetchProductAndAffiliateLink: vi.fn().mockRejectedValue(new Error('timeout')),
    });

    await expect(runPipeline('https://mercadolivre.com.br/MLB123', deps)).rejects.toMatchObject({
      step: 'affiliate_link',
      message: 'timeout',
    });
  });

  it('lança PipelineError no passo shopify_publish quando a publicação falha', async () => {
    const deps = makeDeps({ publishArticle: vi.fn().mockRejectedValue(new Error('rate limit')) });

    await expect(runPipeline('https://mercadolivre.com.br/MLB123', deps)).rejects.toMatchObject({
      step: 'shopify_publish',
    });
  });
});
