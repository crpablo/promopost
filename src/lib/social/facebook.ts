export interface SocialPostResult {
  postId: string;
}

// Loga o erro completo da Graph API (code/subcode/fbtrace_id/uso de rate
// limit) pra diagnóstico — a mensagem lançada pro chamador continua curta,
// mas isso preserva o detalhe real no log do servidor.
function logGraphApiError(context: string, res: Response, json: unknown): void {
  console.error(`${context}:`, {
    status: res.status,
    error: (json as { error?: unknown })?.error,
    businessUseCaseUsage: res.headers?.get('x-business-use-case-usage') ?? null,
    appUsage: res.headers?.get('x-app-usage') ?? null,
  });
}

interface FacebookConfig {
  pageId: string;
  accessToken: string;
}

function getConfig(): FacebookConfig {
  const pageId = process.env.META_PAGE_ID;
  const accessToken = process.env.META_SYSTEM_USER_TOKEN;
  if (!pageId || !accessToken) {
    throw new Error('Variáveis de ambiente da Meta ausentes: META_PAGE_ID, META_SYSTEM_USER_TOKEN');
  }
  return { pageId, accessToken };
}

async function getPageAccessToken(pageId: string, systemUserToken: string): Promise<string> {
  const res = await fetch(
    `https://graph.facebook.com/v26.0/${pageId}?fields=access_token&access_token=${systemUserToken}`,
  );
  const json = await res.json();
  if (!res.ok || json.error || typeof json.access_token !== 'string') {
    logGraphApiError('Falha ao obter token de acesso da Página', res, json);
    throw new Error(`Falha ao obter token de acesso da Página: ${json.error?.message ?? res.status}`);
  }
  return json.access_token;
}

export async function postToFacebook(imageUrl: string, caption: string): Promise<SocialPostResult> {
  const config = getConfig();
  // Um token de Usuário do Sistema não posta direto na Página — a API exige
  // o token de acesso específico da Página, obtido via troca com o token do
  // Usuário do Sistema (descoberto em validação real: postar direto com o
  // token do Usuário do Sistema falha com "(#200) publish_actions...").
  const pageAccessToken = await getPageAccessToken(config.pageId, config.accessToken);

  const res = await fetch(`https://graph.facebook.com/v26.0/${config.pageId}/photos`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      url: imageUrl,
      caption,
      access_token: pageAccessToken,
    }),
  });

  const json = await res.json();
  if (!res.ok || json.error) {
    logGraphApiError('Falha ao postar no Facebook', res, json);
    throw new Error(`Falha ao postar no Facebook: ${json.error?.message ?? res.status}`);
  }

  return { postId: json.post_id ?? json.id };
}
