import { saveTikTokTokens } from '@/lib/social/tiktokTokenStore';

export async function GET(request: Request): Promise<Response> {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get('code');
  const error = searchParams.get('error');

  if (error) {
    return new Response(`Autorização negada pela TikTok: ${error}`, { status: 400 });
  }
  if (!code) {
    return new Response('Parâmetro code ausente', { status: 400 });
  }

  const clientKey = process.env.TIKTOK_CLIENT_KEY;
  const clientSecret = process.env.TIKTOK_CLIENT_SECRET;
  const redirectUri = process.env.TIKTOK_REDIRECT_URI;
  if (!clientKey || !clientSecret || !redirectUri) {
    return new Response('Variáveis de ambiente do TikTok ausentes no servidor', { status: 500 });
  }

  const res = await fetch('https://open.tiktokapis.com/v2/oauth/token/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_key: clientKey,
      client_secret: clientSecret,
      code,
      grant_type: 'authorization_code',
      redirect_uri: redirectUri,
    }),
  });
  const json = await res.json();
  if (!res.ok || !json.access_token) {
    return new Response(
      `Falha ao trocar código por token: ${json.error_description ?? res.status}`,
      { status: 500 },
    );
  }

  await saveTikTokTokens({
    accessToken: json.access_token,
    refreshToken: json.refresh_token,
    expiresAt: Date.now() + json.expires_in * 1000,
  });

  return new Response('Conta do TikTok autorizada com sucesso! Pode fechar esta aba.', {
    status: 200,
    headers: { 'content-type': 'text/plain; charset=utf-8' },
  });
}
