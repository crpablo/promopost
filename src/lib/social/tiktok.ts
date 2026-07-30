import type { SocialPostResult } from './facebook';
import {
  exchangeTikTokToken,
  loadTikTokTokens,
  saveTikTokTokens,
  type TikTokTokens,
} from './tiktokTokenStore';

// Renova o token se faltar menos de 5min pra expirar — margem de segurança
// contra o tempo que a chamada de postagem em si pode levar.
const TOKEN_REFRESH_MARGIN_MS = 5 * 60 * 1000;
const STATUS_POLL_INTERVAL_MS = 2000;
const STATUS_POLL_MAX_ATTEMPTS = 10;

async function refreshAccessToken(refreshToken: string): Promise<TikTokTokens> {
  let tokens: TikTokTokens;
  try {
    tokens = await exchangeTikTokToken({ grant_type: 'refresh_token', refresh_token: refreshToken });
  } catch (err) {
    throw new Error(`Falha ao renovar token do TikTok: ${(err as Error).message}`);
  }
  await saveTikTokTokens(tokens);
  return tokens;
}

async function getValidAccessToken(): Promise<string> {
  const tokens = await loadTikTokTokens();
  if (!tokens) {
    throw new Error('Token do TikTok não configurado — rode o bootstrap (ver runbook)');
  }
  if (Date.now() < tokens.expiresAt - TOKEN_REFRESH_MARGIN_MS) {
    return tokens.accessToken;
  }
  const refreshed = await refreshAccessToken(tokens.refreshToken);
  return refreshed.accessToken;
}

async function waitForPublishComplete(publishId: string, accessToken: string): Promise<void> {
  for (let attempt = 0; attempt < STATUS_POLL_MAX_ATTEMPTS; attempt++) {
    const res = await fetch('https://open.tiktokapis.com/v2/post/publish/status/fetch/', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json; charset=UTF-8',
      },
      body: JSON.stringify({ publish_id: publishId }),
    });
    const json = await res.json();
    if (!res.ok || json.error?.code !== 'ok') {
      throw new Error(`Falha ao checar status da publicação no TikTok: ${json.error?.message ?? res.status}`);
    }
    if (!json.data) {
      throw new Error('Resposta inesperada da TikTok ao checar status da publicação');
    }
    if (json.data?.status === 'PUBLISH_COMPLETE') {
      return;
    }
    if (json.data?.status === 'FAILED') {
      throw new Error(`Falha ao publicar no TikTok: ${json.data?.fail_reason ?? 'motivo desconhecido'}`);
    }
    await new Promise((resolve) => setTimeout(resolve, STATUS_POLL_INTERVAL_MS));
  }
  throw new Error('Falha ao publicar no TikTok: tempo esgotado esperando a publicação concluir');
}

export async function postToTikTok(
  imageUrl: string,
  title: string,
  description: string,
): Promise<SocialPostResult> {
  const accessToken = await getValidAccessToken();

  const res = await fetch('https://open.tiktokapis.com/v2/post/publish/content/init/', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json; charset=UTF-8',
    },
    body: JSON.stringify({
      media_type: 'PHOTO',
      post_mode: 'DIRECT_POST',
      post_info: {
        title,
        description,
        // Até o app passar pela auditoria da TikTok, todo post fica
        // restrito a SELF_ONLY de qualquer forma — pedimos isso
        // explicitamente em vez de tentar PUBLIC_TO_EVERYONE.
        privacy_level: 'SELF_ONLY',
        disable_comment: false,
        auto_add_music: false,
        brand_content_toggle: false,
        brand_organic_toggle: false,
      },
      source_info: {
        source: 'PULL_FROM_URL',
        photo_images: [imageUrl],
        photo_cover_index: 0,
      },
    }),
  });
  const json = await res.json();
  if (!res.ok || json.error?.code !== 'ok' || !json.data?.publish_id) {
    throw new Error(`Falha ao publicar no TikTok: ${json.error?.message ?? res.status}`);
  }

  await waitForPublishComplete(json.data.publish_id, accessToken);

  return { postId: json.data.publish_id };
}
