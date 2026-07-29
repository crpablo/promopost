export interface SocialPostResult {
  postId: string;
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

export async function postToFacebook(imageUrl: string, caption: string): Promise<SocialPostResult> {
  const config = getConfig();

  const res = await fetch(`https://graph.facebook.com/v26.0/${config.pageId}/photos`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      url: imageUrl,
      caption,
      access_token: config.accessToken,
    }),
  });

  const json = await res.json();
  if (!res.ok || json.error) {
    throw new Error(`Falha ao postar no Facebook: ${json.error?.message ?? res.status}`);
  }

  return { postId: json.post_id ?? json.id };
}
