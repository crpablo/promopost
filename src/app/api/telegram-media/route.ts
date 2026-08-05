import { readBufferFile } from '@/lib/storage/localStore';

export async function GET(request: Request): Promise<Response> {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');

  if (!id || !/^\d+$/.test(id)) {
    return Response.json({ erro: 'Parâmetro id inválido' }, { status: 400 });
  }

  const buffer = await readBufferFile(`telegram-media/${id}.jpg`);
  if (!buffer) {
    return Response.json({ erro: 'Imagem não encontrada' }, { status: 404 });
  }

  return new Response(new Uint8Array(buffer), {
    status: 200,
    headers: { 'content-type': 'image/jpeg' },
  });
}
