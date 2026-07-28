import { buildPostText } from '@/lib/content/template';
import { generateAffiliateLink } from '@/lib/mercadolivre/affiliateLink';
import { parseItemId } from '@/lib/mercadolivre/parseLink';
import { fetchProduct } from '@/lib/mercadolivre/productFetcher';
import { PipelineError, runPipeline } from '@/lib/pipeline';
import { publishArticle } from '@/lib/shopify/publisher';

export const maxDuration = 300;

export async function POST(request: Request): Promise<Response> {
  const secret = request.headers.get('x-promopost-secret');
  if (!secret || secret !== process.env.WEBHOOK_SECRET) {
    return Response.json({ erro: 'unauthorized' }, { status: 401 });
  }

  let body: { link?: string };
  try {
    body = await request.json();
  } catch {
    return Response.json({ erro: 'invalid_json' }, { status: 400 });
  }

  if (!body.link) {
    return Response.json({ erro: 'missing_link' }, { status: 400 });
  }

  try {
    const result = await runPipeline(body.link, {
      parseItemId,
      fetchProduct,
      generateAffiliateLink,
      buildPostText,
      publishArticle,
    });
    return Response.json({ postUrl: result.postUrl }, { status: 200 });
  } catch (err) {
    if (err instanceof PipelineError) {
      const status = err.step === 'link_parse' ? 400 : 502;
      return Response.json({ passo: err.step, erro: err.code ?? err.message }, { status });
    }
    return Response.json({ erro: 'internal_error' }, { status: 500 });
  }
}
