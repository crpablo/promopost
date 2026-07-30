import { exchangeTikTokToken, loadTikTokTokens, saveTikTokTokens } from '@/lib/social/tiktokTokenStore';

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

  const redirectUri = process.env.TIKTOK_REDIRECT_URI;
  if (!process.env.TIKTOK_CLIENT_KEY || !process.env.TIKTOK_CLIENT_SECRET || !redirectUri) {
    return new Response('Variáveis de ambiente do TikTok ausentes no servidor', { status: 500 });
  }

  // Defesa contra re-autorização indevida: o token store é single-copy — se
  // alguém montar a própria URL de autorização com o nosso TIKTOK_CLIENT_KEY
  // (que aparece na URL, não é secreto) e mandar o code pra cá, sobrescreve
  // os tokens legítimos pelos dele. Depois da primeira autorização (feita
  // pelo operador), essa rota fica bloqueada até um operador com acesso ao
  // Blob apagar o token deliberadamente pra reautorizar com outra conta.
  const existingTokens = await loadTikTokTokens();
  if (existingTokens) {
    return new Response(
      'Já existe uma conta do TikTok autorizada. Para reautorizar com outra conta, apague o token salvo manualmente antes de repetir este passo.',
      { status: 409 },
    );
  }

  let tokens;
  try {
    tokens = await exchangeTikTokToken({ grant_type: 'authorization_code', code, redirect_uri: redirectUri });
  } catch (err) {
    return new Response(`Falha ao trocar código por token: ${(err as Error).message}`, { status: 500 });
  }

  await saveTikTokTokens(tokens);

  return new Response('Conta do TikTok autorizada com sucesso! Pode fechar esta aba.', {
    status: 200,
    headers: { 'content-type': 'text/plain; charset=utf-8' },
  });
}
