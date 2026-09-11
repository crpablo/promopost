import { auth } from '@/auth';
import { getPool } from '@/lib/db/pool';
import { getBusinessForUser } from '@/lib/db/businesses';
import { getValidAccessTokenForBusiness } from '@/lib/social/tiktokTenantAuth';
import { postToTikTok } from '@/lib/social/tiktok';

function toErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export async function POST(request: Request): Promise<Response> {
  const session = await auth();
  if (!session?.user?.id) {
    return Response.json({ ok: false, error: 'não autorizado' }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ ok: false, error: 'JSON inválido' }, { status: 400 });
  }

  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return Response.json({ ok: false, error: 'JSON inválido' }, { status: 400 });
  }

  const bodyObj = body as { imageUrl?: string; title?: string; description?: string };
  const { imageUrl, title, description } = bodyObj;
  if (!imageUrl || !title || !description) {
    return Response.json(
      { ok: false, error: 'Campos obrigatórios: imageUrl, title, description' },
      { status: 400 },
    );
  }

  const business = await getBusinessForUser(getPool(), session.user.id);
  if (!business) {
    return Response.json({ ok: false, error: 'Empresa não encontrada' }, { status: 400 });
  }

  const baseUrl = process.env.WEBHOOK_BASE_URL;
  if (!baseUrl) {
    return Response.json({ ok: false, error: 'WEBHOOK_BASE_URL não configurado' }, { status: 500 });
  }
  const proxiedImageUrl = `${baseUrl}/api/tiktok-image-proxy?${new URLSearchParams({ imageUrl }).toString()}`;

  try {
    const accessToken = await getValidAccessTokenForBusiness(getPool(), business.id);
    const result = await postToTikTok(accessToken, proxiedImageUrl, title, description);
    return Response.json({ ok: true, postId: result.postId });
  } catch (err) {
    return Response.json({ ok: false, error: toErrorMessage(err) }, { status: 502 });
  }
}
