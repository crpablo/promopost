import { describe, expect, it, vi } from 'vitest';
import { SessionExpiredError, runPipeline, type PipelineDeps } from './pipeline';

function makeDeps(overrides: Partial<PipelineDeps> = {}): PipelineDeps {
  return {
    parseItemId: vi.fn().mockReturnValue('MLB123'),
    fetchProduct: vi
      .fn()
      .mockResolvedValue({ title: 'Produto X', price: 99.9, imageUrl: 'https://x.com/img.jpg' }),
    generateAffiliateLink: vi.fn().mockResolvedValue('https://mercadolivre.com/sec/abc'),
    buildPostText: vi
      .fn()
      .mockReturnValue('Produto X por R$99,90 — confira: https://mercadolivre.com/sec/abc'),
    publishArticle: vi
      .fn()
      .mockResolvedValue({ url: 'https://loja.myshopify.com/blogs/noticias/produto-x' }),
    ...overrides,
  };
}

describe('runPipeline', () => {
  it('roda os 4 passos em ordem e retorna a url do post', async () => {
    const deps = makeDeps();

    const result = await runPipeline('https://mercadolivre.com.br/MLB123', deps);

    expect(result).toEqual({ postUrl: 'https://loja.myshopify.com/blogs/noticias/produto-x' });
    expect(deps.fetchProduct).toHaveBeenCalledWith('MLB123');
    expect(deps.generateAffiliateLink).toHaveBeenCalledWith('https://mercadolivre.com.br/MLB123');
    expect(deps.publishArticle).toHaveBeenCalledWith(
      'Produto X',
      'Produto X por R$99,90 — confira: https://mercadolivre.com/sec/abc',
      'https://x.com/img.jpg',
    );
  });

  it('lança PipelineError no passo link_parse quando o link não é reconhecido', async () => {
    const deps = makeDeps({ parseItemId: vi.fn().mockReturnValue(null) });

    await expect(runPipeline('https://shopee.com.br/x', deps)).rejects.toMatchObject({
      step: 'link_parse',
    });
  });

  it('lança PipelineError no passo product_fetch quando a busca falha', async () => {
    const deps = makeDeps({ fetchProduct: vi.fn().mockRejectedValue(new Error('404')) });

    await expect(runPipeline('https://mercadolivre.com.br/MLB123', deps)).rejects.toMatchObject({
      step: 'product_fetch',
      message: '404',
    });
  });

  it('lança PipelineError com code SESSION_EXPIRED quando a sessão do ML expirou', async () => {
    const deps = makeDeps({
      generateAffiliateLink: vi.fn().mockRejectedValue(new SessionExpiredError()),
    });

    await expect(runPipeline('https://mercadolivre.com.br/MLB123', deps)).rejects.toMatchObject({
      step: 'affiliate_link',
      code: 'SESSION_EXPIRED',
    });
  });

  it('lança PipelineError no passo shopify_publish quando a publicação falha', async () => {
    const deps = makeDeps({ publishArticle: vi.fn().mockRejectedValue(new Error('rate limit')) });

    await expect(runPipeline('https://mercadolivre.com.br/MLB123', deps)).rejects.toMatchObject({
      step: 'shopify_publish',
    });
  });
});
