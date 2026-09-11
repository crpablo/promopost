import { getValidAccessToken, postToTikTok } from '@/lib/social/tiktok';

function toErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ ok: false, error: 'JSON inválido' }, { status: 400 });
  }

  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return Response.json({ ok: false, error: 'JSON inválido' }, { status: 400 });
  }

  const bodyObj = body as { token?: string; imageUrl?: string; title?: string; description?: string };
  if (!bodyObj.token || bodyObj.token !== process.env.ADMIN_TOKEN) {
    return Response.json({ ok: false, error: 'não autorizado' }, { status: 401 });
  }

  const { imageUrl, title, description } = bodyObj;
  if (!imageUrl || !title || !description) {
    return Response.json(
      { ok: false, error: 'Campos obrigatórios: imageUrl, title, description' },
      { status: 400 },
    );
  }

  const baseUrl = process.env.WEBHOOK_BASE_URL;
  if (!baseUrl) {
    return Response.json({ ok: false, error: 'WEBHOOK_BASE_URL não configurado' }, { status: 500 });
  }
  const proxiedImageUrl = `${baseUrl}/api/tiktok-image-proxy?${new URLSearchParams({ imageUrl }).toString()}`;

  try {
    const accessToken = await getValidAccessToken();
    const result = await postToTikTok(accessToken, proxiedImageUrl, title, description);
    return Response.json({ ok: true, postId: result.postId });
  } catch (err) {
    return Response.json({ ok: false, error: toErrorMessage(err) }, { status: 502 });
  }
}
