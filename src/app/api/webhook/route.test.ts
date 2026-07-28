import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/mercadolivre/parseLink', () => ({ parseItemId: vi.fn() }));
vi.mock('@/lib/mercadolivre/productFetcher', () => ({ fetchProduct: vi.fn() }));
vi.mock('@/lib/mercadolivre/affiliateLink', () => ({ generateAffiliateLink: vi.fn() }));
vi.mock('@/lib/content/template', () => ({ buildPostText: vi.fn() }));
vi.mock('@/lib/shopify/publisher', () => ({ publishArticle: vi.fn() }));

import { buildPostText } from '@/lib/content/template';
import { generateAffiliateLink } from '@/lib/mercadolivre/affiliateLink';
import { parseItemId } from '@/lib/mercadolivre/parseLink';
import { fetchProduct } from '@/lib/mercadolivre/productFetcher';
import { SessionExpiredError } from '@/lib/pipeline';
import { publishArticle } from '@/lib/shopify/publisher';
import { POST } from './route';

function makeRequest(body: unknown, secret = 'correct-secret') {
  return new Request('https://promopost.example.com/api/webhook', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-promopost-secret': secret },
    body: JSON.stringify(body),
  });
}

describe('POST /api/webhook', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it('retorna 401 quando o secret está errado', async () => {
    vi.stubEnv('WEBHOOK_SECRET', 'correct-secret');

    const response = await POST(makeRequest({ link: 'https://x.com' }, 'wrong-secret'));

    expect(response.status).toBe(401);
  });

  it('retorna 200 com a url do post no caminho feliz', async () => {
    vi.stubEnv('WEBHOOK_SECRET', 'correct-secret');
    vi.mocked(parseItemId).mockReturnValue('MLB123');
    vi.mocked(fetchProduct).mockResolvedValue({
      title: 'Produto X',
      price: 99.9,
      imageUrl: 'https://x.com/img.jpg',
    });
    vi.mocked(generateAffiliateLink).mockResolvedValue('https://mercadolivre.com/sec/abc');
    vi.mocked(buildPostText).mockReturnValue('texto do post');
    vi.mocked(publishArticle).mockResolvedValue({
      url: 'https://loja.myshopify.com/blogs/noticias/produto-x',
    });

    const response = await POST(makeRequest({ link: 'https://mercadolivre.com.br/MLB123' }));
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json).toEqual({ postUrl: 'https://loja.myshopify.com/blogs/noticias/produto-x' });
  });

  it('retorna 400 com o passo link_parse quando o link é inválido', async () => {
    vi.stubEnv('WEBHOOK_SECRET', 'correct-secret');
    vi.mocked(parseItemId).mockReturnValue(null);

    const response = await POST(makeRequest({ link: 'https://shopee.com.br/x' }));
    const json = await response.json();

    expect(response.status).toBe(400);
    expect(json).toEqual({ passo: 'link_parse', erro: expect.any(String) });
  });

  it('retorna 502 com passo affiliate_link e erro SESSION_EXPIRED quando a sessão expirou', async () => {
    vi.stubEnv('WEBHOOK_SECRET', 'correct-secret');
    vi.mocked(parseItemId).mockReturnValue('MLB123');
    vi.mocked(fetchProduct).mockResolvedValue({
      title: 'Produto X',
      price: 99.9,
      imageUrl: 'https://x.com/img.jpg',
    });
    vi.mocked(generateAffiliateLink).mockRejectedValue(new SessionExpiredError());

    const response = await POST(makeRequest({ link: 'https://mercadolivre.com.br/MLB123' }));
    const json = await response.json();

    expect(response.status).toBe(502);
    expect(json).toEqual({ passo: 'affiliate_link', erro: 'SESSION_EXPIRED' });
  });
});
