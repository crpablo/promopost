// src/app/api/coupon-image/route.tsx
import { ImageResponse } from 'next/og';
import sharp from 'sharp';

function toErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function formatPrice(value: number): string {
  return value.toLocaleString('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export async function GET(request: Request): Promise<Response> {
  const { searchParams } = new URL(request.url);
  const coupon = searchParams.get('coupon');
  const discountPercentParam = searchParams.get('discountPercent');
  const minPurchaseValueParam = searchParams.get('minPurchaseValue');
  const maxDiscountValueParam = searchParams.get('maxDiscountValue');

  if (!coupon) {
    return Response.json({ erro: 'Parâmetro obrigatório ausente: coupon' }, { status: 400 });
  }

  const discountPercent = discountPercentParam !== null ? Number(discountPercentParam) : undefined;
  const minPurchaseValue = minPurchaseValueParam !== null ? Number(minPurchaseValueParam) : undefined;
  const maxDiscountValue = maxDiscountValueParam !== null ? Number(maxDiscountValueParam) : undefined;

  if (discountPercentParam !== null && (!Number.isFinite(discountPercent) || (discountPercent as number) < 0)) {
    return Response.json({ erro: 'Parâmetro discountPercent inválido' }, { status: 400 });
  }
  if (minPurchaseValueParam !== null && (!Number.isFinite(minPurchaseValue) || (minPurchaseValue as number) < 0)) {
    return Response.json({ erro: 'Parâmetro minPurchaseValue inválido' }, { status: 400 });
  }
  if (maxDiscountValueParam !== null && (!Number.isFinite(maxDiscountValue) || (maxDiscountValue as number) < 0)) {
    return Response.json({ erro: 'Parâmetro maxDiscountValue inválido' }, { status: 400 });
  }

  try {
    const pngResponse = new ImageResponse(
      (
        <div
          style={{
            width: '100%',
            height: '100%',
            display: 'flex',
            flexDirection: 'column',
            background: '#2d2d2d',
            padding: '80px 64px',
            justifyContent: 'center',
          }}
        >
          <div
            style={{
              display: 'flex',
              color: '#fff159',
              fontSize: 40,
              fontWeight: 700,
              border: '4px solid #fff159',
              borderRadius: 12,
              padding: '12px 28px',
              alignSelf: 'flex-start',
            }}
          >
            MERCADO LIVRE
          </div>
          <div style={{ display: 'flex', color: 'white', fontSize: 64, fontWeight: 700, marginTop: 48 }}>
            Cupom de desconto
          </div>
          <div style={{ display: 'flex', color: '#ffe14d', fontSize: 80, fontWeight: 700, marginTop: 24 }}>
            {coupon}
          </div>
          {typeof discountPercent === 'number' ? (
            <div style={{ display: 'flex', color: 'white', fontSize: 52, marginTop: 40 }}>
              {discountPercent}% OFF
            </div>
          ) : null}
          {typeof minPurchaseValue === 'number' ? (
            <div style={{ display: 'flex', color: 'rgba(255,255,255,0.85)', fontSize: 36, marginTop: 16 }}>
              Em compras acima de R${formatPrice(minPurchaseValue)}
            </div>
          ) : null}
          {typeof maxDiscountValue === 'number' ? (
            <div style={{ display: 'flex', color: 'rgba(255,255,255,0.85)', fontSize: 36, marginTop: 8 }}>
              Desconto máximo de R${formatPrice(maxDiscountValue)}
            </div>
          ) : null}
        </div>
      ),
      { width: 1080, height: 1350 },
    );

    // next/og produz PNG por padrão — converte pra JPEG de verdade porque
    // alguns consumidores (GramJS, ao repassar essa URL pro Telegram)
    // decidem foto-vs-documento só pela extensão no fim da string da URL,
    // não pelo conteúdo real (mesmo motivo já documentado no proxy do
    // TikTok/Telegram).
    const pngBuffer = Buffer.from(await pngResponse.arrayBuffer());
    const jpegBuffer = await sharp(pngBuffer).jpeg({ quality: 90 }).toBuffer();

    return new Response(new Uint8Array(jpegBuffer), {
      status: 200,
      headers: { 'content-type': 'image/jpeg' },
    });
  } catch (err) {
    console.error('Erro ao gerar imagem de cupom:', err);
    return Response.json(
      { erro: `Falha ao gerar imagem de cupom: ${toErrorMessage(err)}` },
      { status: 500 },
    );
  }
}
