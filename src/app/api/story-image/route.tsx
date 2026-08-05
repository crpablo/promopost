import { ImageResponse } from 'next/og';
import sharp from 'sharp';

function formatPrice(value: number): string {
  return value.toLocaleString('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function toErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

const ALLOWED_IMAGE_HOSTS = [
  /(^|\.)mlstatic\.com$/i,
  /(^|\.)susercontent\.com$/i,
  /(^|\.)media-amazon\.com$/i,
  /(^|\.)ssl-images-amazon\.com$/i,
  /(^|\.)mlcdn\.com\.br$/i,
];

function isAllowedImageHost(url: string): boolean {
  try {
    const hostname = new URL(url).hostname;
    if (ALLOWED_IMAGE_HOSTS.some((pattern) => pattern.test(hostname))) {
      return true;
    }
    // Fotos do Magalu são hospedadas no próprio domínio (rota
    // /api/telegram-media, ver src/lib/magalu/photoOverlay.ts) em vez de um
    // CDN de terceiro — permite o host apontado por WEBHOOK_BASE_URL em vez
    // de fixar o domínio no código.
    const baseUrl = process.env.WEBHOOK_BASE_URL;
    return Boolean(baseUrl && hostname === new URL(baseUrl).hostname);
  } catch {
    return false;
  }
}

// O Satori (motor de renderização do next/og) não decodifica imagens WebP —
// fotos de produto (ex.: Mercado Livre) costumam vir nesse formato e são
// silenciosamente omitidas da imagem final. Buscamos a imagem e convertemos
// pro Satori conseguir renderizar. Usamos JPEG (não PNG) porque comprime
// muito melhor que PNG pra foto, reduzindo o tamanho da resposta.
// Também limitamos a resolução da imagem de origem ao tamanho do frame final
// (1080x1920): testes ao vivo mostraram que o tamanho da resposta escala com
// a resolução da imagem de origem mesmo o canvas de saída sendo fixo — uma
// origem maior não melhora o resultado (que é sempre recortado/cover pro
// mesmo frame), só infla o payload da resposta.
async function toRenderableImage(imageUrl: string): Promise<string> {
  const response = await fetch(imageUrl);
  if (!response.ok) {
    throw new Error(`Falha ao buscar a imagem do produto: ${response.status}`);
  }
  const arrayBuffer = await response.arrayBuffer();
  const jpegBuffer = await sharp(Buffer.from(arrayBuffer))
    .resize({ width: 1080, height: 1920, fit: 'cover' })
    .jpeg({ quality: 85 })
    .toBuffer();
  return `data:image/jpeg;base64,${jpegBuffer.toString('base64')}`;
}

export async function GET(request: Request): Promise<Response> {
  const { searchParams } = new URL(request.url);
  const imageUrl = searchParams.get('imageUrl');
  const title = searchParams.get('title');
  const priceParam = searchParams.get('price');
  const discountedPriceParam = searchParams.get('discountedPrice');
  const coupon = searchParams.get('coupon');

  if (!imageUrl || !title || !priceParam) {
    return Response.json(
      { erro: 'Parâmetros obrigatórios ausentes: imageUrl, title, price' },
      { status: 400 },
    );
  }

  if (!isAllowedImageHost(imageUrl)) {
    return Response.json({ erro: 'Host da imagem não permitido' }, { status: 400 });
  }

  const price = Number(priceParam);
  const discountedPrice = discountedPriceParam ? Number(discountedPriceParam) : undefined;

  if (!Number.isFinite(price) || price < 0) {
    return Response.json({ erro: 'Parâmetro price inválido' }, { status: 400 });
  }
  if (discountedPrice !== undefined && (!Number.isFinite(discountedPrice) || discountedPrice < 0)) {
    return Response.json({ erro: 'Parâmetro discountedPrice inválido' }, { status: 400 });
  }

  try {
    const productImage = await toRenderableImage(imageUrl);

    return new ImageResponse(
      (
        <div style={{ width: '100%', height: '100%', display: 'flex', position: 'relative' }}>
          <img
            src={productImage}
            style={{
              width: '100%',
              height: '100%',
              objectFit: 'cover',
              position: 'absolute',
              display: 'flex',
            }}
          />
          <div
            style={{
              position: 'absolute',
              left: 0,
              right: 0,
              bottom: 0,
              display: 'flex',
              flexDirection: 'column',
              background: 'linear-gradient(to top, rgba(0,0,0,0.85), rgba(0,0,0,0))',
              padding: '40px 32px 56px',
            }}
          >
            <div style={{ display: 'flex', color: 'white', fontSize: 48, fontWeight: 700 }}>
              {title}
            </div>
            {typeof discountedPrice === 'number' ? (
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                <div
                  style={{
                    display: 'flex',
                    color: 'rgba(255,255,255,0.75)',
                    fontSize: 34,
                    textDecoration: 'line-through',
                    marginTop: 12,
                  }}
                >
                  De R${formatPrice(price)}
                </div>
                <div style={{ display: 'flex', color: '#ffe14d', fontSize: 76, fontWeight: 700 }}>
                  R${formatPrice(discountedPrice)}
                </div>
              </div>
            ) : (
              <div
                style={{
                  display: 'flex',
                  color: '#ffe14d',
                  fontSize: 76,
                  fontWeight: 700,
                  marginTop: 12,
                }}
              >
                R${formatPrice(price)}
              </div>
            )}
            {coupon ? (
              <div
                style={{
                  display: 'flex',
                  color: 'white',
                  fontSize: 34,
                  background: '#ff3b5c',
                  padding: '8px 24px',
                  borderRadius: 999,
                  marginTop: 16,
                  alignSelf: 'flex-start',
                }}
              >
                🎟️ {coupon}
              </div>
            ) : null}
          </div>
        </div>
      ),
      { width: 1080, height: 1920 },
    );
  } catch (err) {
    console.error('Erro ao gerar imagem do Story:', err);
    return Response.json(
      { erro: `Falha ao gerar imagem do Story: ${toErrorMessage(err)}` },
      { status: 500 },
    );
  }
}
