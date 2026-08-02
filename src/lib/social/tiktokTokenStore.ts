import { readJsonFile, writeJsonFile } from '../storage/localStore';

const TOKENS_FILENAME = 'tiktok-tokens.json';

export interface TikTokTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}

export async function loadTikTokTokens(): Promise<TikTokTokens | null> {
  try {
    return await readJsonFile<TikTokTokens>(TOKENS_FILENAME);
  } catch (err) {
    throw new Error(`Falha ao carregar token do TikTok: ${(err as Error).message}`);
  }
}

// Troca um código de autorização (grant_type=authorization_code) ou um
// refresh token (grant_type=refresh_token) por um novo par de tokens.
// Centralizado aqui porque tanto tiktok.ts (refreshAccessToken) quanto a
// rota de callback OAuth precisavam da mesma chamada/parse — duplicados,
// nenhum validava o formato da resposta antes de persistir. Como o token
// store é single-copy com allowOverwrite: true, uma resposta malformada da
// TikTok (200 sem refresh_token, ou sem expires_in) corromperia o único
// par salvo permanentemente. Valida a forma da resposta antes de devolver.
export async function exchangeTikTokToken(params: Record<string, string>): Promise<TikTokTokens> {
  const clientKey = process.env.TIKTOK_CLIENT_KEY;
  const clientSecret = process.env.TIKTOK_CLIENT_SECRET;
  if (!clientKey || !clientSecret) {
    throw new Error('Variáveis de ambiente do TikTok ausentes: TIKTOK_CLIENT_KEY, TIKTOK_CLIENT_SECRET');
  }

  const res = await fetch('https://open.tiktokapis.com/v2/oauth/token/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_key: clientKey,
      client_secret: clientSecret,
      ...params,
    }),
  });
  const json = await res.json();
  if (
    !res.ok ||
    typeof json.access_token !== 'string' ||
    typeof json.refresh_token !== 'string' ||
    typeof json.expires_in !== 'number'
  ) {
    throw new Error(`Falha ao trocar token do TikTok: ${json.error_description ?? res.status}`);
  }

  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token,
    expiresAt: Date.now() + json.expires_in * 1000,
  };
}

export async function saveTikTokTokens(tokens: TikTokTokens): Promise<void> {
  try {
    await writeJsonFile(TOKENS_FILENAME, tokens);
  } catch (err) {
    throw new Error(`Falha ao salvar token do TikTok: ${(err as Error).message}`);
  }
}
