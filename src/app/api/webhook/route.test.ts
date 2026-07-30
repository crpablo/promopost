import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/mercadolivre/parseLink', () => ({ parseItemId: vi.fn() }));
vi.mock('@/lib/mercadolivre/affiliateLink', () => ({ fetchProductAndAffiliateLink: vi.fn() }));
vi.mock('@/lib/content/template', () => ({ buildPostText: vi.fn() }));
vi.mock('@/lib/shopify/publisher', () => ({ publishArticle: vi.fn() }));
vi.mock('@/lib/social/caption', () => ({ buildSocialCaption: vi.fn() }));
vi.mock('@/lib/social/facebook', () => ({ postToFacebook: vi.fn() }));
vi.mock('@/lib/social/instagram', () => ({ postToInstagram: vi.fn(), postStoryToInstagram: vi.fn() }));
vi.mock('@/lib/social/tiktok', () => ({ postToTikTok: vi.fn() }));

import { buildPostText } from '@/lib/content/template';
import { fetchProductAndAffiliateLink } from '@/lib/mercadolivre/affiliateLink';
import { parseItemId } from '@/lib/mercadolivre/parseLink';
import { SessionExpiredError } from '@/lib/pipeline';
import { publishArticle } from '@/lib/shopify/publisher';
import { buildSocialCaption } from '@/lib/social/caption';
import { postToFacebook } from '@/lib/social/facebook';
import { postStoryToInstagram, postToInstagram } from '@/lib/social/instagram';
import { postToTikTok } from '@/lib/social/tiktok';
import { POST } from './route';

function makeRequest(body: unknown, secret = 'correct-secret') {
  return new Request('https://promopost.example.com/api/webhook', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-promopost-secret': secret },
    body: JSON.stringify(body),
  });
}

function stubMetaEnv() {
  vi.stubEnv('META_PAGE_ID', '123456789');
  vi.stubEnv('META_IG_BUSINESS_ACCOUNT_ID', '17841400000000000');
  vi.stubEnv('META_SYSTEM_USER_TOKEN', 'fake-meta-token');
}

function stubWebhookBaseUrl() {
  vi.stubEnv('WEBHOOK_BASE_URL', 'https://promopost.example.com');
}

function stubTikTokEnv() {
  vi.stubEnv('TIKTOK_CLIENT_KEY', 'fake-tiktok-key');
  vi.stubEnv('TIKTOK_CLIENT_SECRET', 'fake-tiktok-secret');
}

const PRODUCT = { title: 'Produto X', price: 99.9, imageUrl: 'https://x.com/img.jpg' };

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

  it('retorna 200 com a url do post no caminho feliz, e posta no Facebook, Instagram, Story e TikTok', async () => {
    stubMetaEnv();
    stubWebhookBaseUrl();
    stubTikTokEnv();
    vi.stubEnv('WEBHOOK_SECRET', 'correct-secret');
    vi.mocked(parseItemId).mockReturnValue('MLB123');
    vi.mocked(fetchProductAndAffiliateLink).mockResolvedValue({
      product: PRODUCT,
      affiliateLink: 'https://meli.la/abc',
    });
    vi.mocked(buildPostText).mockReturnValue('texto do post');
    vi.mocked(publishArticle).mockResolvedValue({
      url: 'https://loja.myshopify.com/blogs/noticias/produto-x',
    });
    vi.mocked(buildSocialCaption).mockReturnValue('legenda social');
    vi.mocked(postToFacebook).mockResolvedValue({ postId: 'fb-1' });
    vi.mocked(postToInstagram).mockResolvedValue({ postId: 'ig-1' });
    vi.mocked(postStoryToInstagram).mockResolvedValue({ postId: 'story-1' });
    vi.mocked(postToTikTok).mockResolvedValue({ postId: 'tt-1' });

    const response = await POST(makeRequest({ link: 'https://mercadolivre.com.br/MLB123' }));
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json).toEqual({
      postUrl: 'https://loja.myshopify.com/blogs/noticias/produto-x',
      facebook: { ok: true, postId: 'fb-1' },
      instagram: { ok: true, postId: 'ig-1' },
      story: { ok: true, postId: 'story-1' },
      tiktok: { ok: true, postId: 'tt-1' },
    });
    expect(postToFacebook).toHaveBeenCalledWith('https://x.com/img.jpg', 'legenda social');
    expect(postToInstagram).toHaveBeenCalledWith('https://x.com/img.jpg', 'legenda social');
    expect(postToTikTok).toHaveBeenCalledWith(
      'https://promopost.example.com/api/tiktok-image-proxy?imageUrl=https%3A%2F%2Fx.com%2Fimg.jpg',
      'Produto X',
      'legenda social',
    );
  });

  it('retorna postUrl mesmo quando Facebook, Instagram, Story e TikTok falham (best-effort, não derruba o blog)', async () => {
    stubMetaEnv();
    stubWebhookBaseUrl();
    stubTikTokEnv();
    vi.stubEnv('WEBHOOK_SECRET', 'correct-secret');
    vi.mocked(parseItemId).mockReturnValue('MLB123');
    vi.mocked(fetchProductAndAffiliateLink).mockResolvedValue({
      product: PRODUCT,
      affiliateLink: 'https://meli.la/abc',
    });
    vi.mocked(buildPostText).mockReturnValue('texto do post');
    vi.mocked(publishArticle).mockResolvedValue({
      url: 'https://loja.myshopify.com/blogs/noticias/produto-x',
    });
    vi.mocked(buildSocialCaption).mockReturnValue('legenda social');
    vi.mocked(postToFacebook).mockRejectedValue(new Error('Token inválido'));
    vi.mocked(postToInstagram).mockRejectedValue(new Error('Imagem inválida'));
    vi.mocked(postStoryToInstagram).mockRejectedValue(new Error('Story indisponível'));
    vi.mocked(postToTikTok).mockRejectedValue(new Error('Token do TikTok expirado'));

    const response = await POST(makeRequest({ link: 'https://mercadolivre.com.br/MLB123' }));
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json).toEqual({
      postUrl: 'https://loja.myshopify.com/blogs/noticias/produto-x',
      facebook: { ok: false, error: 'Token inválido' },
      instagram: { ok: false, error: 'Imagem inválida' },
      story: { ok: false, error: 'Story indisponível' },
      tiktok: { ok: false, error: 'Token do TikTok expirado' },
    });
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
    vi.mocked(fetchProductAndAffiliateLink).mockRejectedValue(new SessionExpiredError());

    const response = await POST(makeRequest({ link: 'https://mercadolivre.com.br/MLB123' }));
    const json = await response.json();

    expect(response.status).toBe(502);
    expect(json).toEqual({ passo: 'affiliate_link', erro: 'SESSION_EXPIRED' });
    expect(postToFacebook).not.toHaveBeenCalled();
    expect(postToInstagram).not.toHaveBeenCalled();
    expect(postStoryToInstagram).not.toHaveBeenCalled();
    expect(postToTikTok).not.toHaveBeenCalled();
  });

  it('retorna 400 com erro missing_link quando o body é null', async () => {
    vi.stubEnv('WEBHOOK_SECRET', 'correct-secret');

    const response = await POST(makeRequest(null));
    const json = await response.json();

    expect(response.status).toBe(400);
    expect(json).toEqual({ erro: 'link do produto não informado' });
  });

  it('retorna 200 com o postUrl mesmo quando montar a legenda social falha — e o Story é tentado normalmente, independente da legenda', async () => {
    stubMetaEnv();
    stubWebhookBaseUrl();
    vi.stubEnv('WEBHOOK_SECRET', 'correct-secret');
    vi.mocked(parseItemId).mockReturnValue('MLB123');
    vi.mocked(fetchProductAndAffiliateLink).mockResolvedValue({
      product: PRODUCT,
      affiliateLink: 'https://meli.la/abc',
    });
    vi.mocked(buildPostText).mockReturnValue('texto do post');
    vi.mocked(publishArticle).mockResolvedValue({
      url: 'https://loja.myshopify.com/blogs/noticias/produto-x',
    });
    vi.mocked(buildSocialCaption).mockImplementation(() => {
      throw new Error('produto malformado');
    });
    vi.mocked(postStoryToInstagram).mockResolvedValue({ postId: 'story-1' });

    const response = await POST(makeRequest({ link: 'https://mercadolivre.com.br/MLB123' }));
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json).toEqual({
      postUrl: 'https://loja.myshopify.com/blogs/noticias/produto-x',
      facebook: { ok: false, error: 'produto malformado' },
      instagram: { ok: false, error: 'produto malformado' },
      story: { ok: true, postId: 'story-1' },
      tiktok: { ok: false, error: 'não configurado' },
    });
    expect(postToFacebook).not.toHaveBeenCalled();
    expect(postToInstagram).not.toHaveBeenCalled();
    expect(postStoryToInstagram).toHaveBeenCalledTimes(1);
    expect(postToTikTok).not.toHaveBeenCalled();
  });

  it('retorna 200 com Meta e TikTok configurados simultaneamente quando montar a legenda social falha — facebook, instagram e tiktok propagam o erro, Story é tentado normalmente', async () => {
    stubMetaEnv();
    stubWebhookBaseUrl();
    stubTikTokEnv();
    vi.stubEnv('WEBHOOK_SECRET', 'correct-secret');
    vi.mocked(parseItemId).mockReturnValue('MLB123');
    vi.mocked(fetchProductAndAffiliateLink).mockResolvedValue({
      product: PRODUCT,
      affiliateLink: 'https://meli.la/abc',
    });
    vi.mocked(buildPostText).mockReturnValue('texto do post');
    vi.mocked(publishArticle).mockResolvedValue({
      url: 'https://loja.myshopify.com/blogs/noticias/produto-x',
    });
    vi.mocked(buildSocialCaption).mockImplementation(() => {
      throw new Error('produto malformado');
    });
    vi.mocked(postStoryToInstagram).mockResolvedValue({ postId: 'story-1' });

    const response = await POST(makeRequest({ link: 'https://mercadolivre.com.br/MLB123' }));
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json).toEqual({
      postUrl: 'https://loja.myshopify.com/blogs/noticias/produto-x',
      facebook: { ok: false, error: 'produto malformado' },
      instagram: { ok: false, error: 'produto malformado' },
      story: { ok: true, postId: 'story-1' },
      tiktok: { ok: false, error: 'produto malformado' },
    });
    expect(postToFacebook).not.toHaveBeenCalled();
    expect(postToInstagram).not.toHaveBeenCalled();
    expect(postToTikTok).not.toHaveBeenCalled();
    expect(postStoryToInstagram).toHaveBeenCalledTimes(1);
  });

  it('retorna story com erro quando WEBHOOK_BASE_URL não está configurado, sem afetar Facebook/Instagram', async () => {
    stubMetaEnv();
    vi.stubEnv('WEBHOOK_SECRET', 'correct-secret');
    vi.mocked(parseItemId).mockReturnValue('MLB123');
    vi.mocked(fetchProductAndAffiliateLink).mockResolvedValue({
      product: PRODUCT,
      affiliateLink: 'https://meli.la/abc',
    });
    vi.mocked(buildPostText).mockReturnValue('texto do post');
    vi.mocked(publishArticle).mockResolvedValue({
      url: 'https://loja.myshopify.com/blogs/noticias/produto-x',
    });
    vi.mocked(buildSocialCaption).mockReturnValue('legenda social');
    vi.mocked(postToFacebook).mockResolvedValue({ postId: 'fb-1' });
    vi.mocked(postToInstagram).mockResolvedValue({ postId: 'ig-1' });

    const response = await POST(makeRequest({ link: 'https://mercadolivre.com.br/MLB123' }));
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json).toEqual({
      postUrl: 'https://loja.myshopify.com/blogs/noticias/produto-x',
      facebook: { ok: true, postId: 'fb-1' },
      instagram: { ok: true, postId: 'ig-1' },
      story: { ok: false, error: 'WEBHOOK_BASE_URL não configurado' },
      tiktok: { ok: false, error: 'não configurado' },
    });
    expect(postStoryToInstagram).not.toHaveBeenCalled();
  });

  it('pula Facebook, Instagram e Story quando as variáveis da Meta não estão configuradas, mas ainda tenta o TikTok se ele estiver configurado', async () => {
    stubTikTokEnv();
    stubWebhookBaseUrl();
    vi.stubEnv('WEBHOOK_SECRET', 'correct-secret');
    vi.mocked(parseItemId).mockReturnValue('MLB123');
    vi.mocked(fetchProductAndAffiliateLink).mockResolvedValue({
      product: PRODUCT,
      affiliateLink: 'https://meli.la/abc',
    });
    vi.mocked(buildPostText).mockReturnValue('texto do post');
    vi.mocked(publishArticle).mockResolvedValue({
      url: 'https://loja.myshopify.com/blogs/noticias/produto-x',
    });
    vi.mocked(buildSocialCaption).mockReturnValue('legenda social');
    vi.mocked(postToTikTok).mockResolvedValue({ postId: 'tt-1' });

    const response = await POST(makeRequest({ link: 'https://mercadolivre.com.br/MLB123' }));
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json).toEqual({
      postUrl: 'https://loja.myshopify.com/blogs/noticias/produto-x',
      facebook: { ok: false, error: 'não configurado' },
      instagram: { ok: false, error: 'não configurado' },
      story: { ok: false, error: 'não configurado' },
      tiktok: { ok: true, postId: 'tt-1' },
    });
    expect(postToFacebook).not.toHaveBeenCalled();
    expect(postToInstagram).not.toHaveBeenCalled();
    expect(postStoryToInstagram).not.toHaveBeenCalled();
    expect(postToTikTok).toHaveBeenCalledWith(
      'https://promopost.example.com/api/tiktok-image-proxy?imageUrl=https%3A%2F%2Fx.com%2Fimg.jpg',
      'Produto X',
      'legenda social',
    );
  });

  it('reporta erro no TikTok quando WEBHOOK_BASE_URL não está configurado, mesmo com o TikTok configurado', async () => {
    stubTikTokEnv();
    vi.stubEnv('WEBHOOK_SECRET', 'correct-secret');
    vi.mocked(parseItemId).mockReturnValue('MLB123');
    vi.mocked(fetchProductAndAffiliateLink).mockResolvedValue({
      product: PRODUCT,
      affiliateLink: 'https://meli.la/abc',
    });
    vi.mocked(buildPostText).mockReturnValue('texto do post');
    vi.mocked(publishArticle).mockResolvedValue({
      url: 'https://loja.myshopify.com/blogs/noticias/produto-x',
    });
    vi.mocked(buildSocialCaption).mockReturnValue('legenda social');

    const response = await POST(makeRequest({ link: 'https://mercadolivre.com.br/MLB123' }));
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.tiktok).toEqual({ ok: false, error: 'WEBHOOK_BASE_URL não configurado' });
    expect(postToTikTok).not.toHaveBeenCalled();
  });

  it('pula o TikTok quando só ele não está configurado, mesmo com a Meta configurada', async () => {
    stubMetaEnv();
    stubWebhookBaseUrl();
    vi.stubEnv('WEBHOOK_SECRET', 'correct-secret');
    vi.mocked(parseItemId).mockReturnValue('MLB123');
    vi.mocked(fetchProductAndAffiliateLink).mockResolvedValue({
      product: PRODUCT,
      affiliateLink: 'https://meli.la/abc',
    });
    vi.mocked(buildPostText).mockReturnValue('texto do post');
    vi.mocked(publishArticle).mockResolvedValue({
      url: 'https://loja.myshopify.com/blogs/noticias/produto-x',
    });
    vi.mocked(buildSocialCaption).mockReturnValue('legenda social');
    vi.mocked(postToFacebook).mockResolvedValue({ postId: 'fb-1' });
    vi.mocked(postToInstagram).mockResolvedValue({ postId: 'ig-1' });
    vi.mocked(postStoryToInstagram).mockResolvedValue({ postId: 'story-1' });

    const response = await POST(makeRequest({ link: 'https://mercadolivre.com.br/MLB123' }));
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.tiktok).toEqual({ ok: false, error: 'não configurado' });
    expect(postToTikTok).not.toHaveBeenCalled();
  });

  it('trunca o título do TikTok em 90 caracteres', async () => {
    stubTikTokEnv();
    stubWebhookBaseUrl();
    vi.stubEnv('WEBHOOK_SECRET', 'correct-secret');
    vi.mocked(parseItemId).mockReturnValue('MLB123');
    const longTitle = 'A'.repeat(120);
    vi.mocked(fetchProductAndAffiliateLink).mockResolvedValue({
      product: { title: longTitle, price: 99.9, imageUrl: 'https://x.com/img.jpg' },
      affiliateLink: 'https://meli.la/abc',
    });
    vi.mocked(buildPostText).mockReturnValue('texto do post');
    vi.mocked(publishArticle).mockResolvedValue({
      url: 'https://loja.myshopify.com/blogs/noticias/produto-x',
    });
    vi.mocked(buildSocialCaption).mockReturnValue('legenda social');
    vi.mocked(postToTikTok).mockResolvedValue({ postId: 'tt-1' });

    await POST(makeRequest({ link: 'https://mercadolivre.com.br/MLB123' }));

    const [, calledTitle] = vi.mocked(postToTikTok).mock.calls[0];
    expect(calledTitle).toHaveLength(90);
    expect(calledTitle).toBe('A'.repeat(90));
  });

  it('repassa coupon e discountedPrice do body pro runPipeline e pra URL da imagem do Story', async () => {
    stubMetaEnv();
    stubWebhookBaseUrl();
    vi.stubEnv('WEBHOOK_SECRET', 'correct-secret');
    vi.mocked(parseItemId).mockReturnValue('https://mercadolivre.com.br/MLB123');
    vi.mocked(fetchProductAndAffiliateLink).mockResolvedValue({
      product: PRODUCT,
      affiliateLink: 'https://meli.la/abc',
    });
    vi.mocked(buildPostText).mockReturnValue('texto do post');
    vi.mocked(publishArticle).mockResolvedValue({
      url: 'https://loja.myshopify.com/blogs/noticias/produto-x',
    });
    vi.mocked(buildSocialCaption).mockReturnValue('legenda social');
    vi.mocked(postToFacebook).mockResolvedValue({ postId: 'fb-1' });
    vi.mocked(postToInstagram).mockResolvedValue({ postId: 'ig-1' });
    vi.mocked(postStoryToInstagram).mockResolvedValue({ postId: 'story-1' });

    await POST(
      makeRequest({
        link: 'https://mercadolivre.com.br/MLB123',
        coupon: 'PROMO10',
        discountedPrice: 79.9,
      }),
    );

    expect(buildPostText).toHaveBeenCalledWith(PRODUCT, 'https://meli.la/abc', 'PROMO10', 79.9);
    expect(buildSocialCaption).toHaveBeenCalledWith(PRODUCT, 'https://meli.la/abc', 'PROMO10', 79.9);

    const [storyImageUrl] = vi.mocked(postStoryToInstagram).mock.calls[0];
    const params = new URL(storyImageUrl).searchParams;
    expect(params.get('coupon')).toBe('PROMO10');
    expect(params.get('discountedPrice')).toBe('79.9');
  });

  it('retorna 400 com erro cupom inválido quando coupon não é string', async () => {
    vi.stubEnv('WEBHOOK_SECRET', 'correct-secret');

    const response = await POST(
      makeRequest({ link: 'https://mercadolivre.com.br/MLB123', coupon: 123 }),
    );
    const json = await response.json();

    expect(response.status).toBe(400);
    expect(json).toEqual({ erro: 'cupom inválido' });
  });

  it('retorna 400 com erro preço com desconto inválido quando discountedPrice não é number', async () => {
    vi.stubEnv('WEBHOOK_SECRET', 'correct-secret');

    const response = await POST(
      makeRequest({ link: 'https://mercadolivre.com.br/MLB123', discountedPrice: null }),
    );
    const json = await response.json();

    expect(response.status).toBe(400);
    expect(json).toEqual({ erro: 'preço com desconto inválido' });
  });
});
