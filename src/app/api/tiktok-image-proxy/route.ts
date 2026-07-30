const ALLOWED_IMAGE_HOSTS = [/(^|\.)mlstatic\.com$/i];

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

  const body = await upstream.arrayBuffer();
  const contentType = upstream.headers.get('content-type') ?? 'application/octet-stream';
  return new Response(body, { status: 200, headers: { 'content-type': contentType } });
}
