import { buildPostText } from '@/lib/content/template';
import { buildCouponArticleText, buildCouponCaption, type CouponDetails } from '@/lib/content/couponTemplate';
import { buildMagaluAffiliateLink, isMagaluLink } from '@/lib/magalu/affiliateLink';
import { fetchProductAndAffiliateLink } from '@/lib/mercadolivre/affiliateLink';
import type { Product } from '@/lib/marketplace/types';
import { parseItemId } from '@/lib/mercadolivre/parseLink';
import { ListCouponError, PipelineError, runPipeline } from '@/lib/pipeline';
import { publishArticle } from '@/lib/shopify/publisher';
import { buildSocialCaption } from '@/lib/social/caption';
import { postToFacebook } from '@/lib/social/facebook';
import { postStoryToInstagram, postToInstagram } from '@/lib/social/instagram';
import { postToTikTok } from '@/lib/social/tiktok';
import { postToTelegramGroups } from '@/lib/social/telegramGroups';
import type { TelegramGroupsResult } from '@/lib/social/telegramGroups';
import { deleteFile } from '@/lib/storage/localStore';

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

function isTelegramGroupsConfigured(): boolean {
  return Boolean(process.env.TELEGRAM_TARGET_GROUP_IDS);
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

function buildCouponImageUrl(details: CouponDetails): string {
  const baseUrl = process.env.WEBHOOK_BASE_URL;
  if (!baseUrl) {
    throw new Error('WEBHOOK_BASE_URL não configurado');
  }
  const params = new URLSearchParams({ coupon: details.coupon });
  if (typeof details.discountPercent === 'number') {
    params.set('discountPercent', String(details.discountPercent));
  }
  if (typeof details.minPurchaseValue === 'number') {
    params.set('minPurchaseValue', String(details.minPurchaseValue));
  }
  if (typeof details.maxDiscountValue === 'number') {
    params.set('maxDiscountValue', String(details.maxDiscountValue));
  }
  return `${baseUrl}/api/coupon-image?${params.toString()}`;
}

async function postToSocialNetworks(
  product: Product,
  affiliateLink: string,
  coupon?: string,
  discountedPrice?: number,
): Promise<{
  facebook: SocialResult;
  instagram: SocialResult;
  story: SocialResult;
  tiktok: SocialResult;
  telegram: TelegramGroupsResult;
}> {
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
  let captionError: { ok: false; error: string } | undefined;
  if (isMetaConfigured() || isTikTokConfigured() || isTelegramGroupsConfigured()) {
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

  const telegramPromise: Promise<TelegramGroupsResult> = (async () => {
    if (!isTelegramGroupsConfigured()) return { ok: false, results: [] };
    if (captionError) return { ok: false, results: [], error: captionError.error };
    try {
      // Reaproveita o proxy do TikTok (que já normaliza pra JPEG) em vez da
      // product.imageUrl crua. O motivo não é o Content-Type em si — é que
      // o GramJS decide "foto vs documento" só olhando a extensão no fim da
      // string da URL (Utils.isImage/_getExtension, sem round-trip pro
      // servidor), e nossa própria URL de proxy não termina em .jpg/.png —
      // a query string embutida às vezes termina em ".webp" (a extensão da
      // imagem original), fazendo cair como "documento" genérico e deixar a
      // legenda pouco visível, mesmo com o conteúdo já sendo JPEG de fato
      // (confirmado em validação manual real, 2026-08-04, lendo o histórico
      // de mensagens direto pela API). O fragment "#.jpg" no final força
      // essa detecção sem afetar a URL de verdade que o servidor do
      // Telegram busca (fragments nunca são enviados numa requisição HTTP).
      const proxiedImageUrl = `${buildTikTokImageProxyUrl(product)}#.jpg`;
      return await postToTelegramGroups(proxiedImageUrl, caption as string);
    } catch (err) {
      console.error('Erro ao disparar pros grupos do Telegram:', err);
      return { ok: false, results: [], error: toErrorMessage(err) };
    }
  })();

  const [facebook, instagram, story, tiktok, telegram] = await Promise.all([
    facebookPromise,
    instagramPromise,
    storyResultPromise,
    tiktokPromise,
    telegramPromise,
  ]);

  return { facebook, instagram, story, tiktok, telegram };
}

async function postCouponToSocialNetworks(
  couponImageUrl: string,
  caption: string,
  articleTitle: string,
): Promise<{
  facebook: SocialResult;
  instagram: SocialResult;
  story: SocialResult;
  tiktok: SocialResult;
  telegram: TelegramGroupsResult;
}> {
  const storyPromise: Promise<SocialResult> = (async () => {
    if (!isMetaConfigured()) return NAO_CONFIGURADO;
    try {
      const r = await postStoryToInstagram(couponImageUrl);
      return { ok: true, postId: r.postId };
    } catch (err) {
      console.error('Erro ao postar Story do cupom no Instagram:', err);
      return { ok: false, error: toErrorMessage(err) };
    }
  })();

  const facebookPromise: Promise<SocialResult> = (async () => {
    if (!isMetaConfigured()) return NAO_CONFIGURADO;
    try {
      const r = await postToFacebook(couponImageUrl, caption);
      return { ok: true, postId: r.postId };
    } catch (err) {
      console.error('Erro ao postar cupom no Facebook:', err);
      return { ok: false, error: toErrorMessage(err) };
    }
  })();

  const instagramPromise: Promise<SocialResult> = (async () => {
    if (!isMetaConfigured()) return NAO_CONFIGURADO;
    try {
      const r = await postToInstagram(couponImageUrl, caption);
      return { ok: true, postId: r.postId };
    } catch (err) {
      console.error('Erro ao postar cupom no Instagram:', err);
      return { ok: false, error: toErrorMessage(err) };
    }
  })();

  const tiktokPromise: Promise<SocialResult> = (async () => {
    if (!isTikTokConfigured()) return NAO_CONFIGURADO;
    try {
      const r = await postToTikTok(couponImageUrl, articleTitle.slice(0, 90), caption);
      return { ok: true, postId: r.postId };
    } catch (err) {
      console.error('Erro ao postar cupom no TikTok:', err);
      return { ok: false, error: toErrorMessage(err) };
    }
  })();

  const telegramPromise: Promise<TelegramGroupsResult> = (async () => {
    if (!isTelegramGroupsConfigured()) return { ok: false, results: [] };
    try {
      // Mesmo motivo do fragment "#.jpg" já documentado em postToSocialNetworks.
      return await postToTelegramGroups(`${couponImageUrl}#.jpg`, caption);
    } catch (err) {
      console.error('Erro ao disparar cupom pros grupos do Telegram:', err);
      return { ok: false, results: [], error: toErrorMessage(err) };
    }
  })();

  const [facebook, instagram, story, tiktok, telegram] = await Promise.all([
    facebookPromise,
    instagramPromise,
    storyPromise,
    tiktokPromise,
    telegramPromise,
  ]);

  return { facebook, instagram, story, tiktok, telegram };
}

export async function POST(request: Request): Promise<Response> {
  const secret = request.headers.get('x-promopost-secret');
  if (!secret || secret !== process.env.WEBHOOK_SECRET) {
    return Response.json({ erro: 'não autorizado' }, { status: 401 });
  }

  let body: {
    link?: string;
    coupon?: string;
    discountedPrice?: number;
    discountPercent?: number;
    minPurchaseValue?: number;
    maxDiscountValue?: number;
    title?: string;
    originalPrice?: number;
    photoUrl?: string;
  };
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
  if (body.discountPercent !== undefined && typeof body.discountPercent !== 'number') {
    return Response.json({ erro: 'percentual de desconto inválido' }, { status: 400 });
  }
  if (body.minPurchaseValue !== undefined && typeof body.minPurchaseValue !== 'number') {
    return Response.json({ erro: 'valor mínimo de compra inválido' }, { status: 400 });
  }
  if (body.maxDiscountValue !== undefined && typeof body.maxDiscountValue !== 'number') {
    return Response.json({ erro: 'desconto máximo inválido' }, { status: 400 });
  }
  if (body.title !== undefined && typeof body.title !== 'string') {
    return Response.json({ erro: 'título inválido' }, { status: 400 });
  }
  if (body.originalPrice !== undefined && typeof body.originalPrice !== 'number') {
    return Response.json({ erro: 'preço original inválido' }, { status: 400 });
  }
  if (body.photoUrl !== undefined && typeof body.photoUrl !== 'string') {
    return Response.json({ erro: 'URL de foto inválida' }, { status: 400 });
  }

  if (isMagaluLink(body.link)) {
    if (!body.title || !body.photoUrl) {
      return Response.json(
        { erro: 'mensagem do Magalu sem título ou foto — não é possível publicar' },
        { status: 400 },
      );
    }
    const price = body.originalPrice ?? body.discountedPrice;
    if (typeof price !== 'number') {
      return Response.json(
        { erro: 'mensagem do Magalu sem preço — não é possível publicar' },
        { status: 400 },
      );
    }

    const partnerId = process.env.MAGALU_PARTNER_ID;
    const promoterId = process.env.MAGALU_PROMOTER_ID;
    if (!partnerId || !promoterId) {
      return Response.json(
        { erro: 'Variáveis de ambiente do Magalu ausentes: MAGALU_PARTNER_ID, MAGALU_PROMOTER_ID' },
        { status: 500 },
      );
    }

    const photoId = new URL(body.photoUrl).searchParams.get('id');
    const discountedForCaption = body.originalPrice !== undefined ? body.discountedPrice : undefined;

    try {
      const product: Product = {
        title: body.title,
        price,
        imageUrl: body.photoUrl,
        marketplace: 'magalu',
      };
      const affiliateLink = buildMagaluAffiliateLink(body.link, partnerId, promoterId);
      const postBody = buildPostText(product, affiliateLink, body.coupon, discountedForCaption);
      const published = await publishArticle(product.title, postBody, product.imageUrl);
      const { facebook, instagram, story, tiktok, telegram } = await postToSocialNetworks(
        product,
        affiliateLink,
        body.coupon,
        discountedForCaption,
      );

      return Response.json(
        { postUrl: published.url, facebook, instagram, story, tiktok, telegram },
        { status: 200 },
      );
    } catch (err) {
      console.error('Erro ao publicar produto do Magalu:', err);
      return Response.json({ erro: 'erro interno ao publicar produto do Magalu' }, { status: 500 });
    } finally {
      if (photoId) {
        await deleteFile(`telegram-media/${photoId}.jpg`);
      }
    }
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

    const { facebook, instagram, story, tiktok, telegram } = await postToSocialNetworks(
      result.product,
      result.affiliateLink,
      body.coupon,
      body.discountedPrice,
    );

    return Response.json(
      { postUrl: result.postUrl, facebook, instagram, story, tiktok, telegram },
      { status: 200 },
    );
  } catch (err) {
    if (err instanceof ListCouponError) {
      if (!body.coupon) {
        console.error('ListCouponError sem coupon no corpo — não é possível publicar sem código de cupom');
        return Response.json(
          { erro: 'cupom de lista detectado, mas nenhum código de cupom foi informado' },
          { status: 400 },
        );
      }
      try {
        const couponDetails: CouponDetails = {
          coupon: body.coupon,
          affiliateLink: err.affiliateLink,
          discountPercent: body.discountPercent,
          minPurchaseValue: body.minPurchaseValue,
          maxDiscountValue: body.maxDiscountValue,
        };
        const caption = buildCouponCaption(couponDetails);
        const { title, body: articleBody } = buildCouponArticleText(couponDetails);
        const couponImageUrl = buildCouponImageUrl(couponDetails);

        const published = await publishArticle(title, articleBody, couponImageUrl);

        const { facebook, instagram, story, tiktok, telegram } = await postCouponToSocialNetworks(
          couponImageUrl,
          caption,
          title,
        );

        return Response.json(
          { postUrl: published.url, facebook, instagram, story, tiktok, telegram },
          { status: 200 },
        );
      } catch (couponErr) {
        console.error('Erro ao publicar cupom de lista:', couponErr);
        return Response.json({ erro: 'erro interno ao publicar cupom' }, { status: 500 });
      }
    }
    console.error('Erro no pipeline PromoPost:', err);
    if (err instanceof PipelineError) {
      const status = err.step === 'link_parse' ? 400 : 502;
      return Response.json({ passo: err.step, erro: err.code ?? err.message }, { status });
    }
    return Response.json({ erro: 'erro interno' }, { status: 500 });
  }
}
