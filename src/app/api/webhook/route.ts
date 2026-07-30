import { buildPostText } from '@/lib/content/template';
import { fetchProductAndAffiliateLink } from '@/lib/mercadolivre/affiliateLink';
import type { Product } from '@/lib/mercadolivre/affiliateLink';
import { parseItemId } from '@/lib/mercadolivre/parseLink';
import { PipelineError, runPipeline } from '@/lib/pipeline';
import { publishArticle } from '@/lib/shopify/publisher';
import { buildSocialCaption } from '@/lib/social/caption';
import { postToFacebook } from '@/lib/social/facebook';
import { postStoryToInstagram, postToInstagram } from '@/lib/social/instagram';

export const maxDuration = 300;

type SocialResult = { ok: true; postId: string } | { ok: false; error: string };

function isMetaConfigured(): boolean {
  return Boolean(
    process.env.META_PAGE_ID && process.env.META_IG_BUSINESS_ACCOUNT_ID && process.env.META_SYSTEM_USER_TOKEN,
  );
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

async function postToSocialNetworks(
  product: Product,
  affiliateLink: string,
  coupon?: string,
  discountedPrice?: number,
): Promise<{ facebook: SocialResult; instagram: SocialResult; story: SocialResult }> {
  if (!isMetaConfigured()) {
    const naoConfigurado: SocialResult = { ok: false, error: 'não configurado' };
    return { facebook: naoConfigurado, instagram: naoConfigurado, story: naoConfigurado };
  }

  // O Story não depende da legenda do feed — usa dados brutos do produto
  // direto na URL da imagem, então começa em paralelo, independente do
  // resultado de buildSocialCaption abaixo.
  const storyResultPromise: Promise<SocialResult> = Promise.resolve()
    .then(() => buildStoryImageUrl(product, coupon, discountedPrice))
    .then((storyImageUrl) => postStoryToInstagram(storyImageUrl))
    .then((r): SocialResult => ({ ok: true, postId: r.postId }))
    .catch((err: unknown): SocialResult => {
      console.error('Erro ao postar Story no Instagram:', err);
      return { ok: false, error: toErrorMessage(err) };
    });

  let caption: string;
  try {
    caption = buildSocialCaption(product, affiliateLink, coupon, discountedPrice);
  } catch (err) {
    console.error('Erro ao montar legenda social:', err);
    const erro: SocialResult = { ok: false, error: toErrorMessage(err) };
    const story = await storyResultPromise;
    return { facebook: erro, instagram: erro, story };
  }

  const [facebook, instagram, story] = await Promise.all([
    postToFacebook(product.imageUrl, caption)
      .then((r): SocialResult => ({ ok: true, postId: r.postId }))
      .catch((err: unknown): SocialResult => {
        console.error('Erro ao postar no Facebook:', err);
        return { ok: false, error: toErrorMessage(err) };
      }),
    postToInstagram(product.imageUrl, caption)
      .then((r): SocialResult => ({ ok: true, postId: r.postId }))
      .catch((err: unknown): SocialResult => {
        console.error('Erro ao postar no Instagram:', err);
        return { ok: false, error: toErrorMessage(err) };
      }),
    storyResultPromise,
  ]);

  return { facebook, instagram, story };
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

    const { facebook, instagram, story } = await postToSocialNetworks(
      result.product,
      result.affiliateLink,
      body.coupon,
      body.discountedPrice,
    );

    return Response.json({ postUrl: result.postUrl, facebook, instagram, story }, { status: 200 });
  } catch (err) {
    console.error('Erro no pipeline PromoPost:', err);
    if (err instanceof PipelineError) {
      const status = err.step === 'link_parse' ? 400 : 502;
      return Response.json({ passo: err.step, erro: err.code ?? err.message }, { status });
    }
    return Response.json({ erro: 'erro interno' }, { status: 500 });
  }
}
