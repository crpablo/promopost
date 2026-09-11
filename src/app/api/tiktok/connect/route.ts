import { NextResponse } from 'next/server';
import { auth } from '@/auth';

const STATE_COOKIE = 'tiktok_oauth_state';
const STATE_COOKIE_MAX_AGE_SECONDS = 10 * 60;

export async function GET(request: Request): Promise<Response> {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.redirect(new URL('/login', request.url));
  }

  const clientKey = process.env.TIKTOK_CLIENT_KEY;
  const redirectUri = process.env.TIKTOK_TENANT_REDIRECT_URI;
  if (!clientKey || !redirectUri) {
    return new Response('Variáveis de ambiente do TikTok ausentes no servidor', { status: 500 });
  }

  const state = crypto.randomUUID();
  const params = new URLSearchParams({
    client_key: clientKey,
    response_type: 'code',
    scope: 'video.publish',
    redirect_uri: redirectUri,
    state,
  });

  const response = NextResponse.redirect(`https://www.tiktok.com/v2/auth/authorize/?${params.toString()}`);
  response.cookies.set(STATE_COOKIE, state, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    maxAge: STATE_COOKIE_MAX_AGE_SECONDS,
    path: '/',
  });
  return response;
}
