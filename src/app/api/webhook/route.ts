import { buildPostText } from '@/lib/content/template';
import { fetchProductAndAffiliateLink } from '@/lib/mercadolivre/affiliateLink';
import type { Product } from '@/lib/mercadolivre/affiliateLink';
import { parseItemId } from '@/lib/mercadolivre/parseLink';
import { PipelineError, runPipeline } from '@/lib/pipeline';
import { publishArticle } from '@/lib/shopify/publisher';
import { buildSocialCaption } from '@/lib/social/caption';
import { postToFacebook } from '@/lib/social/facebook';
import { postStoryToInstagram, postToInstagram } from '@/lib/social/instagram';
import { postToTikTok } from '@/lib/social/tiktok';

export const maxDuration = 300;

type SocialResult = { ok: true; postId: string } | { ok: false; error: string };

const NAO_CONFIGURADO: SocialResult = { ok: false, error: 'não configurado' };

function isMetaConfigured(): boolean {
  return Boolean(
    process.env.META_PAGE_ID && process.env.META_IG_BUSINESS_ACCOUNT_ID && process.env.META_SYSTEM_USER_TOKEN,
  );
}

function isTikTokConfigured(): boolean {
  return Boolean(process.env.TIKTOK_CLIENT_KEY && process.env.TIKTOK_CLIENT_SECRET);
}

function toErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function buildStoryImageUrl(product: Product, coupon?: string, discountedPrice?: number): string {
  const baseUrl = process.env.WEBHOOK_BASE_URL;
  if (!baseUrl) {
    throw new Error('WEBHOOK_BASE_URL não configurado');
  }
  const params = new URLSearchParams({
    imageUrl: product.imageUrl,
    title: product.title,
    price: String(product.price),
  });
  if (typeof discountedPrice === 'number') {
    params.set('discountedPrice', String(discountedPrice));
  }
  if (coupon) {
    params.set('coupon', coupon);
  }
  return `${baseUrl}/api/story-image?${params.toString()}`;
}

function buildTikTokImageProxyUrl(product: Product): string {
  const baseUrl = process.env.WEBHOOK_BASE_URL;
  if (!baseUrl) {
    throw new Error('WEBHOOK_BASE_URL não configurado');
  }
  const params = new URLSearchParams({ imageUrl: product.imageUrl });
  return `${baseUrl}/api/tiktok-image-proxy?${params.toString()}`;
}

async function postToSocialNetworks(
  product: Product,
  affiliateLink: string,
  coupon?: string,
  discountedPrice?: number,
): Promise<{ facebook: SocialResult; instagram: SocialResult; story: SocialResult; tiktok: SocialResult }> {
  // O Story usa dados brutos do produto, não a legenda — tem seu próprio
  // gate (Meta) e roda totalmente independente do resto.
  const storyResultPromise: Promise<SocialResult> = (async () => {
    if (!isMetaConfigured()) {
      return NAO_CONFIGURADO;
    }
    try {
      const storyImageUrl = buildStoryImageUrl(product, coupon, discountedPrice);
      const r = await postStoryToInstagram(storyImageUrl);
      return { ok: true, postId: r.postId };
    } catch (err) {
      console.error('Erro ao postar Story no Instagram:', err);
      return { ok: false, error: toErrorMessage(err) };
    }
  })();

  // Facebook, Instagram (feed) e TikTok reaproveitam a mesma legenda — só
  // monta ela se pelo menos uma dessas três redes estiver configurada.
  let caption: string | undefined;
  let captionError: SocialResult | undefined;
  if (isMetaConfigured() || isTikTokConfigured()) {
    try {
      caption = buildSocialCaption(product, affiliateLink, coupon, discountedPrice);
    } catch (err) {
      console.error('Erro ao montar legenda social:', err);
      captionError = { ok: false, error: toErrorMessage(err) };
    }
  }

  const facebookPromise: Promise<SocialResult> = (async () => {
    if (!isMetaConfigured()) return NAO_CONFIGURADO;
    if (captionError) return captionError;
    try {
      const r = await postToFacebook(product.imageUrl, caption as string);
      return { ok: true, postId: r.postId };
    } catch (err) {
      console.error('Erro ao postar no Facebook:', err);
      return { ok: false, error: toErrorMessage(err) };
    }
  })();

  const instagramPromise: Promise<SocialResult> = (async () => {
    if (!isMetaConfigured()) return NAO_CONFIGURADO;
    if (captionError) return captionError;
    try {
      const r = await postToInstagram(product.imageUrl, caption as string);
      return { ok: true, postId: r.postId };
    } catch (err) {
      console.error('Erro ao postar no Instagram:', err);
      return { ok: false, error: toErrorMessage(err) };
    }
  })();

  const tiktokPromise: Promise<SocialResult> = (async () => {
    if (!isTikTokConfigured()) return NAO_CONFIGURADO;
    if (captionError) return captionError;
    try {
      const proxiedImageUrl = buildTikTokImageProxyUrl(product);
      const title = product.title.slice(0, 90);
      const r = await postToTikTok(proxiedImageUrl, title, caption as string);
      return { ok: true, postId: r.postId };
    } catch (err) {
      console.error('Erro ao postar no TikTok:', err);
      return { ok: false, error: toErrorMessage(err) };
    }
  })();

  const [facebook, instagram, story, tiktok] = await Promise.all([
    facebookPromise,
    instagramPromise,
    storyResultPromise,
    tiktokPromise,
  ]);

  return { facebook, instagram, story, tiktok };
}

export async function POST(request: Request): Promise<Response> {
  const secret = request.headers.get('x-promopost-secret');
  if (!secret || secret !== process.env.WEBHOOK_SECRET) {
    return Response.json({ erro: 'não autorizado' }, { status: 401 });
  }

  let body: { link?: string; coupon?: string; discountedPrice?: number };
  try {
    body = await request.json();
  } catch {
    return Response.json({ erro: 'corpo da requisição não é JSON válido' }, { status: 400 });
  }

  if (!body?.link) {
    return Response.json({ erro: 'link do produto não informado' }, { status: 400 });
  }

  if (body.coupon !== undefined && typeof body.coupon !== 'string') {
    return Response.json({ erro: 'cupom inválido' }, { status: 400 });
  }
  if (body.discountedPrice !== undefined && typeof body.discountedPrice !== 'number') {
    return Response.json({ erro: 'preço com desconto inválido' }, { status: 400 });
  }

  try {
    const result = await runPipeline(
      body.link,
      {
        parseItemId,
        fetchProductAndAffiliateLink,
        buildPostText,
        publishArticle,
      },
      { coupon: body.coupon, discountedPrice: body.discountedPrice },
    );

    const { facebook, instagram, story, tiktok } = await postToSocialNetworks(
      result.product,
      result.affiliateLink,
      body.coupon,
      body.discountedPrice,
    );

    return Response.json(
      { postUrl: result.postUrl, facebook, instagram, story, tiktok },
      { status: 200 },
    );
  } catch (err) {
    console.error('Erro no pipeline PromoPost:', err);
    if (err instanceof PipelineError) {
      const status = err.step === 'link_parse' ? 400 : 502;
      return Response.json({ passo: err.step, erro: err.code ?? err.message }, { status });
    }
    return Response.json({ erro: 'erro interno' }, { status: 500 });
  }
}
