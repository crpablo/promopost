import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { exchangeTikTokToken } from '@/lib/social/tiktokTokenStore';
import { getBusinessForUser } from '@/lib/db/businesses';
import { saveTikTokAccountForBusiness } from '@/lib/db/tiktokAccounts';
import { getPool } from '@/lib/db/pool';

const STATE_COOKIE = 'tiktok_oauth_state';

function readCookie(request: Request, name: string): string | undefined {
  const header = request.headers.get('cookie');
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return rest.join('=');
  }
  return undefined;
}

export async function GET(request: Request): Promise<Response> {
  // Atrás do nginx, `request.url` reflete o endereço interno do container
  // (http://localhost:3000), não o domínio público — usa AUTH_URL (já
  // exigido pelo Auth.js em produção) como base pros redirects que saem
  // daqui, com request.url só como fallback pra dev local/testes. Ler os
  // searchParams da própria request ainda usa request.url normalmente, já
  // que isso não constrói uma URL pública nova, só lê a que já chegou.
  const baseUrl = process.env.AUTH_URL ?? request.url;

  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.redirect(new URL('/login', baseUrl));
  }

  const { searchParams } = new URL(request.url);
  const error = searchParams.get('error');
  const code = searchParams.get('code');
  const state = searchParams.get('state');
  const cookieState = readCookie(request, STATE_COOKIE);

  function failResponse(): Response {
    const response = NextResponse.redirect(new URL('/dashboard?tiktok_error=1', baseUrl));
    response.cookies.delete(STATE_COOKIE);
    return response;
  }

  if (error || !code || !state || !cookieState || state !== cookieState) {
    return failResponse();
  }

  const redirectUri = process.env.TIKTOK_TENANT_REDIRECT_URI;
  if (!redirectUri) {
    return new Response('Variáveis de ambiente do TikTok ausentes no servidor', { status: 500 });
  }

  try {
    const tokens = await exchangeTikTokToken({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
    });
    const business = await getBusinessForUser(getPool(), session.user.id);
    if (!business) {
      return failResponse();
    }
    await saveTikTokAccountForBusiness(getPool(), business.id, {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresAt: new Date(tokens.expiresAt),
    });
  } catch {
    return failResponse();
  }

  const response = NextResponse.redirect(new URL('/dashboard', baseUrl));
  response.cookies.delete(STATE_COOKIE);
  return response;
}
