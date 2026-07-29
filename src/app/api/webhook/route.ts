import { buildPostText } from '@/lib/content/template';
import { fetchProductAndAffiliateLink } from '@/lib/mercadolivre/affiliateLink';
import { parseItemId } from '@/lib/mercadolivre/parseLink';
import { PipelineError, runPipeline } from '@/lib/pipeline';
import { publishArticle } from '@/lib/shopify/publisher';
import { buildSocialCaption } from '@/lib/social/caption';
import { postToFacebook } from '@/lib/social/facebook';
import { postToInstagram } from '@/lib/social/instagram';

export const maxDuration = 300;

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

    const caption = buildSocialCaption(result.product, result.affiliateLink, body.coupon, body.discountedPrice);

    const [facebook, instagram] = await Promise.all([
      postToFacebook(result.product.imageUrl, caption)
        .then((r) => ({ ok: true as const, postId: r.postId }))
        .catch((err: Error) => {
          console.error('Erro ao postar no Facebook:', err);
          return { ok: false as const, error: err.message };
        }),
      postToInstagram(result.product.imageUrl, caption)
        .then((r) => ({ ok: true as const, postId: r.postId }))
        .catch((err: Error) => {
          console.error('Erro ao postar no Instagram:', err);
          return { ok: false as const, error: err.message };
        }),
    ]);

    return Response.json({ postUrl: result.postUrl, facebook, instagram }, { status: 200 });
  } catch (err) {
    console.error('Erro no pipeline PromoPost:', err);
    if (err instanceof PipelineError) {
      const status = err.step === 'link_parse' ? 400 : 502;
      return Response.json({ passo: err.step, erro: err.code ?? err.message }, { status });
    }
    return Response.json({ erro: 'erro interno' }, { status: 500 });
  }
}
