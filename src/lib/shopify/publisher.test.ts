import { afterEach, describe, expect, it, vi } from 'vitest';
import { publishArticle } from './publisher';

function stubEnv() {
  vi.stubEnv('SHOPIFY_SHOP_DOMAIN', 'minha-loja.myshopify.com');
  vi.stubEnv('SHOPIFY_ADMIN_ACCESS_TOKEN', 'shpat_fake');
  vi.stubEnv('SHOPIFY_BLOG_ID', 'gid://shopify/Blog/123');
}

describe('publishArticle', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('cria o artigo como rascunho e retorna a url montada', async () => {
    stubEnv();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: {
          articleCreate: {
            article: {
              id: 'gid://shopify/Article/999',
              handle: 'produto-x',
              blog: { handle: 'noticias' },
            },
            userErrors: [],
          },
        },
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await publishArticle(
      'Produto X',
      'Produto X por R$99,90 — confira: https://x.com',
      'https://x.com/img.jpg',
    );

    expect(result.url).toBe('https://minha-loja.myshopify.com/blogs/noticias/produto-x');

    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe('https://minha-loja.myshopify.com/admin/api/2026-04/graphql.json');
    expect(options.headers['X-Shopify-Access-Token']).toBe('shpat_fake');
    const parsedBody = JSON.parse(options.body);
    expect(parsedBody.variables.article.isPublished).toBe(false);
    expect(parsedBody.variables.article.blogId).toBe('gid://shopify/Blog/123');
  });

  it('lança erro quando a API retorna userErrors', async () => {
    stubEnv();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          data: {
            articleCreate: {
              article: null,
              userErrors: [{ field: ['blogId'], message: 'Blog não encontrado' }],
            },
          },
        }),
      }),
    );

    await expect(
      publishArticle('Produto X', 'texto', 'https://x.com/img.jpg'),
    ).rejects.toThrow('Blog não encontrado');
  });

  it('lança erro quando faltam variáveis de ambiente', async () => {
    await expect(publishArticle('T', 'B', 'https://x.com/img.jpg')).rejects.toThrow(
      'Variáveis de ambiente do Shopify ausentes',
    );
  });

  it('escapa caracteres especiais de HTML no corpo do artigo', async () => {
    stubEnv();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: {
          articleCreate: {
            article: { id: 'gid://shopify/Article/1', handle: 'x', blog: { handle: 'noticias' } },
            userErrors: [],
          },
        },
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await publishArticle('Título', 'Produto <script>alert(1)</script> & cia', 'https://x.com/img.jpg');

    const [, options] = fetchMock.mock.calls[0];
    const parsedBody = JSON.parse(options.body);
    expect(parsedBody.variables.article.body).toBe(
      '<p>Produto &lt;script&gt;alert(1)&lt;/script&gt; &amp; cia</p>',
    );
  });
});
