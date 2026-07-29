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
