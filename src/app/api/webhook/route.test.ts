import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/mercadolivre/parseLink', () => ({ parseItemId: vi.fn() }));
vi.mock('@/lib/mercadolivre/affiliateLink', () => ({ fetchProductAndAffiliateLink: vi.fn() }));
vi.mock('@/lib/content/template', () => ({ buildPostText: vi.fn() }));
vi.mock('@/lib/shopify/publisher', () => ({ publishArticle: vi.fn() }));
vi.mock('@/lib/social/caption', () => ({ buildSocialCaption: vi.fn() }));
vi.mock('@/lib/social/facebook', () => ({ postToFacebook: vi.fn() }));
vi.mock('@/lib/social/instagram', () => ({ postToInstagram: vi.fn(), postStoryToInstagram: vi.fn() }));
vi.mock('@/lib/social/tiktok', () => ({ postToTikTok: vi.fn() }));
vi.mock('@/lib/social/telegramGroups', () => ({ postToTelegramGroups: vi.fn() }));
vi.mock('@/lib/content/couponTemplate', () => ({
  buildCouponCaption: vi.fn(),
  buildCouponArticleText: vi.fn(),
}));
vi.mock('@/lib/storage/localStore', () => ({ deleteFile: vi.fn() }));

import { buildPostText } from '@/lib/content/template';
import { buildCouponArticleText, buildCouponCaption } from '@/lib/content/couponTemplate';
import { fetchProductAndAffiliateLink } from '@/lib/mercadolivre/affiliateLink';
import { parseItemId } from '@/lib/mercadolivre/parseLink';
import { ListCouponError, SessionExpiredError } from '@/lib/pipeline';
import { publishArticle } from '@/lib/shopify/publisher';
import { buildSocialCaption } from '@/lib/social/caption';
import { postToFacebook } from '@/lib/social/facebook';
import { postStoryToInstagram, postToInstagram } from '@/lib/social/instagram';
import { postToTikTok } from '@/lib/social/tiktok';
import { postToTelegramGroups } from '@/lib/social/telegramGroups';
import { deleteFile } from '@/lib/storage/localStore';
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

function stubTelegramGroupsEnv() {
  vi.stubEnv('TELEGRAM_TARGET_GROUP_IDS', '-100111');
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
    stubTelegramGroupsEnv();
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
    vi.mocked(postToTelegramGroups).mockResolvedValue({
      ok: true,
      results: [{ groupId: '-100111', ok: true }],
    });

    const response = await POST(makeRequest({ link: 'https://mercadolivre.com.br/MLB123' }));
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json).toEqual({
      postUrl: 'https://loja.myshopify.com/blogs/noticias/produto-x',
      facebook: { ok: true, postId: 'fb-1' },
      instagram: { ok: true, postId: 'ig-1' },
      story: { ok: true, postId: 'story-1' },
      tiktok: { ok: true, postId: 'tt-1' },
      telegram: { ok: true, results: [{ groupId: '-100111', ok: true }] },
    });
    expect(postToFacebook).toHaveBeenCalledWith('https://x.com/img.jpg', 'legenda social');
    expect(postToInstagram).toHaveBeenCalledWith('https://x.com/img.jpg', 'legenda social');
    expect(postToTikTok).toHaveBeenCalledWith(
      'https://promopost.example.com/api/tiktok-image-proxy?imageUrl=https%3A%2F%2Fx.com%2Fimg.jpg',
      'Produto X',
      'legenda social',
    );
    expect(postToTelegramGroups).toHaveBeenCalledWith(
      'https://promopost.example.com/api/tiktok-image-proxy?imageUrl=https%3A%2F%2Fx.com%2Fimg.jpg#.jpg',
      'legenda social',
    );
  });

  it('publica produto do Magalu direto da mensagem, sem chamar o pipeline de scraping', async () => {
    vi.stubEnv('WEBHOOK_SECRET', 'correct-secret');
    stubMetaEnv();
    stubWebhookBaseUrl();
    stubTikTokEnv();
    stubTelegramGroupsEnv();
    vi.stubEnv('MAGALU_PARTNER_ID', '3440');
    vi.stubEnv('MAGALU_PROMOTER_ID', '5784620');
    vi.mocked(buildPostText).mockReturnValue('texto do post');
    vi.mocked(publishArticle).mockResolvedValue({
      url: 'https://loja.myshopify.com/blogs/noticias/carregador-portatil',
    });
    vi.mocked(buildSocialCaption).mockReturnValue('legenda social');
    vi.mocked(postToFacebook).mockResolvedValue({ postId: 'fb-magalu-1' });
    vi.mocked(postToInstagram).mockResolvedValue({ postId: 'ig-magalu-1' });
    vi.mocked(postStoryToInstagram).mockResolvedValue({ postId: 'story-magalu-1' });
    vi.mocked(postToTikTok).mockResolvedValue({ postId: 'tt-magalu-1' });
    vi.mocked(postToTelegramGroups).mockResolvedValue({
      ok: true,
      results: [{ groupId: '-100111', ok: true }],
    });

    const response = await POST(
      makeRequest({
        link: 'https://www.magazineluiza.com.br/carregador-portatil-turbo-power-bank/p/dkba5b776g/te/accp/?partner_id=9999&promoter_id=1111111',
        title: 'Carregador Portátil Turbo Power Bank',
        originalPrice: 129.9,
        discountedPrice: 89.9,
        photoUrl: 'https://promopost.example.com/api/telegram-media?id=55',
      }),
    );
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json).toEqual({
      postUrl: 'https://loja.myshopify.com/blogs/noticias/carregador-portatil',
      facebook: { ok: true, postId: 'fb-magalu-1' },
      instagram: { ok: true, postId: 'ig-magalu-1' },
      story: { ok: true, postId: 'story-magalu-1' },
      tiktok: { ok: true, postId: 'tt-magalu-1' },
      telegram: { ok: true, results: [{ groupId: '-100111', ok: true }] },
    });
    expect(fetchProductAndAffiliateLink).not.toHaveBeenCalled();
    expect(buildPostText).toHaveBeenCalledWith(
      {
        title: 'Carregador Portátil Turbo Power Bank',
        price: 129.9,
        imageUrl: 'https://promopost.example.com/api/telegram-media?id=55',
        marketplace: 'magalu',
      },
      'https://www.magazineluiza.com.br/carregador-portatil-turbo-power-bank/p/dkba5b776g/te/accp/?partner_id=3440&promoter_id=5784620&utm_source=divulgador&utm_medium=magalu&utm_campaign=5784620',
      undefined,
      89.9,
    );
    expect(deleteFile).toHaveBeenCalledWith('telegram-media/55.jpg');
  });

  it('usa discountedPrice como preço quando o Magalu não informa originalPrice', async () => {
    vi.stubEnv('WEBHOOK_SECRET', 'correct-secret');
    stubMetaEnv();
    stubWebhookBaseUrl();
    vi.stubEnv('MAGALU_PARTNER_ID', '3440');
    vi.stubEnv('MAGALU_PROMOTER_ID', '5784620');
    vi.mocked(buildPostText).mockReturnValue('texto do post');
    vi.mocked(publishArticle).mockResolvedValue({ url: 'https://loja.myshopify.com/blogs/noticias/x' });
    vi.mocked(buildSocialCaption).mockReturnValue('legenda social');
    vi.mocked(postToFacebook).mockResolvedValue({ postId: 'fb-1' });
    vi.mocked(postToInstagram).mockResolvedValue({ postId: 'ig-1' });
    vi.mocked(postStoryToInstagram).mockResolvedValue({ postId: 'story-1' });

    await POST(
      makeRequest({
        link: 'https://www.magazineluiza.com.br/produto-x/p/abc123/',
        title: 'Produto X',
        discountedPrice: 59.9,
        photoUrl: 'https://promopost.example.com/api/telegram-media?id=99',
      }),
    );

    expect(buildPostText).toHaveBeenCalledWith(
      {
        title: 'Produto X',
        price: 59.9,
        imageUrl: 'https://promopost.example.com/api/telegram-media?id=99',
        marketplace: 'magalu',
      },
      'https://www.magazineluiza.com.br/produto-x/p/abc123/?partner_id=3440&promoter_id=5784620&utm_source=divulgador&utm_medium=magalu&utm_campaign=5784620',
      undefined,
      undefined,
    );
  });

  it('retorna 400 quando o link é do Magalu mas falta title ou photoUrl', async () => {
    vi.stubEnv('WEBHOOK_SECRET', 'correct-secret');

    const response = await POST(
      makeRequest({ link: 'https://www.magazineluiza.com.br/produto-x/p/abc123/' }),
    );
    const json = await response.json();

    expect(response.status).toBe(400);
    expect(json).toEqual({ erro: 'mensagem do Magalu sem título ou foto — não é possível publicar' });
    expect(fetchProductAndAffiliateLink).not.toHaveBeenCalled();
  });

  it('retorna 400 quando o link é do Magalu mas não tem nenhum preço', async () => {
    vi.stubEnv('WEBHOOK_SECRET', 'correct-secret');

    const response = await POST(
      makeRequest({
        link: 'https://www.magazineluiza.com.br/produto-x/p/abc123/',
        title: 'Produto X',
        photoUrl: 'https://promopost.example.com/api/telegram-media?id=55',
      }),
    );
    const json = await response.json();

    expect(response.status).toBe(400);
    expect(json).toEqual({ erro: 'mensagem do Magalu sem preço — não é possível publicar' });
  });

  it('retorna 500 e apaga o arquivo da foto quando a publicação do produto do Magalu falha', async () => {
    vi.stubEnv('WEBHOOK_SECRET', 'correct-secret');
    vi.stubEnv('MAGALU_PARTNER_ID', '3440');
    vi.stubEnv('MAGALU_PROMOTER_ID', '5784620');
    vi.mocked(buildPostText).mockReturnValue('texto do post');
    vi.mocked(publishArticle).mockRejectedValue(new Error('Shopify indisponível'));

    const response = await POST(
      makeRequest({
        link: 'https://www.magazineluiza.com.br/produto-x/p/abc123/',
        title: 'Produto X',
        originalPrice: 99.9,
        photoUrl: 'https://promopost.example.com/api/telegram-media?id=77',
      }),
    );
    const json = await response.json();

    expect(response.status).toBe(500);
    expect(json).toEqual({ erro: 'erro interno ao publicar produto do Magalu' });
    expect(deleteFile).toHaveBeenCalledWith('telegram-media/77.jpg');
  });

  it('retorna postUrl mesmo quando Facebook, Instagram, Story e TikTok falham (best-effort, não derruba o blog)', async () => {
    stubMetaEnv();
    stubWebhookBaseUrl();
    stubTikTokEnv();
    stubTelegramGroupsEnv();
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
    vi.mocked(postToTelegramGroups).mockRejectedValue(new Error('Sessão do Telegram expirada'));

    const response = await POST(makeRequest({ link: 'https://mercadolivre.com.br/MLB123' }));
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json).toEqual({
      postUrl: 'https://loja.myshopify.com/blogs/noticias/produto-x',
      facebook: { ok: false, error: 'Token inválido' },
      instagram: { ok: false, error: 'Imagem inválida' },
      story: { ok: false, error: 'Story indisponível' },
      tiktok: { ok: false, error: 'Token do TikTok expirado' },
      telegram: { ok: false, results: [], error: 'Sessão do Telegram expirada' },
    });
  });

  it('monta a legenda e posta só no Telegram quando apenas ele está configurado (Meta e TikTok ausentes)', async () => {
    stubTelegramGroupsEnv();
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
    vi.mocked(postToTelegramGroups).mockResolvedValue({
      ok: true,
      results: [{ groupId: '-100111', ok: true }],
    });

    const response = await POST(makeRequest({ link: 'https://mercadolivre.com.br/MLB123' }));
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json).toEqual({
      postUrl: 'https://loja.myshopify.com/blogs/noticias/produto-x',
      facebook: { ok: false, error: 'não configurado' },
      instagram: { ok: false, error: 'não configurado' },
      story: { ok: false, error: 'não configurado' },
      tiktok: { ok: false, error: 'não configurado' },
      telegram: { ok: true, results: [{ groupId: '-100111', ok: true }] },
    });
    expect(buildSocialCaption).toHaveBeenCalled();
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
      telegram: { ok: false, results: [] },
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
      telegram: { ok: false, results: [] },
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
      telegram: { ok: false, results: [] },
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
      telegram: { ok: false, results: [] },
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

  it('publica um post de cupom em todos os canais quando o pipeline rejeita com ListCouponError', async () => {
    stubMetaEnv();
    stubWebhookBaseUrl();
    stubTikTokEnv();
    stubTelegramGroupsEnv();
    vi.stubEnv('WEBHOOK_SECRET', 'correct-secret');
    vi.mocked(parseItemId).mockReturnValue('MLB123');
    vi.mocked(fetchProductAndAffiliateLink).mockRejectedValue(
      new ListCouponError('https://mercadolivre.com/sec/xyz789'),
    );
    vi.mocked(buildCouponCaption).mockReturnValue('legenda do cupom');
    vi.mocked(buildCouponArticleText).mockReturnValue({
      title: 'Cupom Mercado Livre: 20% OFF em compras acima de R$59,00',
      body: 'corpo do artigo do cupom',
    });
    vi.mocked(publishArticle).mockResolvedValue({
      url: 'https://loja.myshopify.com/blogs/noticias/cupom-mercado-livre',
    });
    vi.mocked(postToFacebook).mockResolvedValue({ postId: 'fb-cupom-1' });
    vi.mocked(postToInstagram).mockResolvedValue({ postId: 'ig-cupom-1' });
    vi.mocked(postStoryToInstagram).mockResolvedValue({ postId: 'story-cupom-1' });
    vi.mocked(postToTikTok).mockResolvedValue({ postId: 'tt-cupom-1' });
    vi.mocked(postToTelegramGroups).mockResolvedValue({
      ok: true,
      results: [{ groupId: '-100111', ok: true }],
    });

    const response = await POST(
      makeRequest({
        link: 'https://www.mercadolivre.com.br/social/promozonevip/lists',
        coupon: 'LIVROSJOGOSRELAMPAGO',
        discountPercent: 20,
        minPurchaseValue: 59,
        maxDiscountValue: 30,
      }),
    );
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json).toEqual({
      postUrl: 'https://loja.myshopify.com/blogs/noticias/cupom-mercado-livre',
      facebook: { ok: true, postId: 'fb-cupom-1' },
      instagram: { ok: true, postId: 'ig-cupom-1' },
      story: { ok: true, postId: 'story-cupom-1' },
      tiktok: { ok: true, postId: 'tt-cupom-1' },
      telegram: { ok: true, results: [{ groupId: '-100111', ok: true }] },
    });
    expect(buildCouponCaption).toHaveBeenCalledWith({
      coupon: 'LIVROSJOGOSRELAMPAGO',
      affiliateLink: 'https://mercadolivre.com/sec/xyz789',
      discountPercent: 20,
      minPurchaseValue: 59,
      maxDiscountValue: 30,
    });
    expect(publishArticle).toHaveBeenCalledWith(
      'Cupom Mercado Livre: 20% OFF em compras acima de R$59,00',
      'corpo do artigo do cupom',
      'https://promopost.example.com/api/coupon-image?coupon=LIVROSJOGOSRELAMPAGO&discountPercent=20&minPurchaseValue=59&maxDiscountValue=30',
    );
  });

  it('retorna 400 quando ListCouponError acontece mas nenhum coupon foi informado no corpo', async () => {
    vi.stubEnv('WEBHOOK_SECRET', 'correct-secret');
    vi.mocked(parseItemId).mockReturnValue('MLB123');
    vi.mocked(fetchProductAndAffiliateLink).mockRejectedValue(
      new ListCouponError('https://mercadolivre.com/sec/xyz789'),
    );

    const response = await POST(
      makeRequest({ link: 'https://www.mercadolivre.com.br/social/promozonevip/lists' }),
    );
    const json = await response.json();

    expect(response.status).toBe(400);
    expect(json).toEqual({ erro: 'cupom de lista detectado, mas nenhum código de cupom foi informado' });
  });
});
