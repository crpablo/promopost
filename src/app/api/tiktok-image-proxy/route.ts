import sharp from 'sharp';

const ALLOWED_IMAGE_HOSTS = [
  /(^|\.)mlstatic\.com$/i,
  /(^|\.)susercontent\.com$/i,
  /(^|\.)media-amazon\.com$/i,
  /(^|\.)ssl-images-amazon\.com$/i,
];

function isAllowedImageHost(url: string): boolean {
  try {
    const hostname = new URL(url).hostname;
    return ALLOWED_IMAGE_HOSTS.some((pattern) => pattern.test(hostname));
  } catch {
    return false;
  }
}

export async function GET(request: Request): Promise<Response> {
  const { searchParams } = new URL(request.url);
  const imageUrl = searchParams.get('imageUrl');

  if (!imageUrl) {
    return Response.json({ erro: 'Parâmetro obrigatório ausente: imageUrl' }, { status: 400 });
  }
  if (!isAllowedImageHost(imageUrl)) {
    return Response.json({ erro: 'Host da imagem não permitido' }, { status: 400 });
  }

  const upstream = await fetch(imageUrl);
  if (!upstream.ok) {
    return Response.json(
      { erro: `Falha ao buscar a imagem original: ${upstream.status}` },
      { status: 502 },
    );
  }

  // Normaliza sempre pra JPEG: fotos de produto do Mercado Livre costumam vir
  // em WebP (ver comentário equivalente em story-image/route.tsx, baseado em
  // teste real) e não sabemos se a TikTok aceita WebP em PULL_FROM_URL. Não
  // redimensiona nem compõe overlay — só decodifica e reencoda, preservando
  // a resolução original (a TikTok já lida com isso).
  const arrayBuffer = await upstream.arrayBuffer();
  let jpegBuffer: Buffer;
  try {
    jpegBuffer = await sharp(Buffer.from(arrayBuffer)).jpeg({ quality: 90 }).toBuffer();
  } catch (err) {
    return Response.json(
      { erro: `Falha ao normalizar a imagem para JPEG: ${(err as Error).message}` },
      { status: 502 },
    );
  }

  return new Response(new Uint8Array(jpegBuffer), {
    status: 200,
    headers: { 'content-type': 'image/jpeg' },
  });
}
