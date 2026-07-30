import type { SocialPostResult } from './facebook';

interface InstagramConfig {
  igUserId: string;
  accessToken: string;
}

function getConfig(): InstagramConfig {
  const igUserId = process.env.META_IG_BUSINESS_ACCOUNT_ID;
  const accessToken = process.env.META_SYSTEM_USER_TOKEN;
  if (!igUserId || !accessToken) {
    throw new Error(
      'Variáveis de ambiente da Meta ausentes: META_IG_BUSINESS_ACCOUNT_ID, META_SYSTEM_USER_TOKEN',
    );
  }
  return { igUserId, accessToken };
}

// O Instagram baixa e processa a imagem de forma assíncrona depois de criar
// o container — publicar antes disso pronto falha com "Media ID is not
// available" (descoberto em validação real). Espera o status virar FINISHED
// antes de publicar.
const CONTAINER_POLL_INTERVAL_MS = 2000;
const CONTAINER_POLL_MAX_ATTEMPTS = 10;

async function waitForContainerReady(containerId: string, accessToken: string): Promise<void> {
  for (let attempt = 0; attempt < CONTAINER_POLL_MAX_ATTEMPTS; attempt++) {
    const res = await fetch(
      `https://graph.facebook.com/v26.0/${containerId}?fields=status_code&access_token=${accessToken}`,
    );
    const json = await res.json();
    if (!res.ok || json.error) {
      throw new Error(`Falha ao checar status da mídia do Instagram: ${json.error?.message ?? res.status}`);
    }
    if (json.status_code === 'FINISHED') {
      return;
    }
    if (json.status_code === 'ERROR') {
      throw new Error('Falha ao processar mídia do Instagram: status ERROR no container');
    }
    await new Promise((resolve) => setTimeout(resolve, CONTAINER_POLL_INTERVAL_MS));
  }
  throw new Error('Falha ao processar mídia do Instagram: tempo esgotado esperando o container ficar pronto');
}

export async function postToInstagram(imageUrl: string, caption: string): Promise<SocialPostResult> {
  const config = getConfig();

  const createRes = await fetch(`https://graph.facebook.com/v26.0/${config.igUserId}/media`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      image_url: imageUrl,
      caption,
      access_token: config.accessToken,
    }),
  });
  const createJson = await createRes.json();
  if (!createRes.ok || createJson.error || !createJson.id) {
    throw new Error(`Falha ao criar mídia do Instagram: ${createJson.error?.message ?? createRes.status}`);
  }

  await waitForContainerReady(createJson.id, config.accessToken);

  const publishRes = await fetch(`https://graph.facebook.com/v26.0/${config.igUserId}/media_publish`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      creation_id: createJson.id,
      access_token: config.accessToken,
    }),
  });
  const publishJson = await publishRes.json();
  if (!publishRes.ok || publishJson.error || !publishJson.id) {
    throw new Error(
      `Falha ao publicar mídia do Instagram: ${publishJson.error?.message ?? publishRes.status}`,
    );
  }

  return { postId: publishJson.id };
}
