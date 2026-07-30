import { list, put } from '@vercel/blob';

const TOKENS_PATHNAME = 'tiktok-tokens.json';

export interface TikTokTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}

export async function loadTikTokTokens(): Promise<TikTokTokens | null> {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  const { blobs } = await list({ prefix: TOKENS_PATHNAME, token });
  const match = blobs.find((b) => b.pathname === TOKENS_PATHNAME);
  if (!match) {
    return null;
  }
  const res = await fetch(match.url, {
    headers: { authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    throw new Error(`Falha ao carregar token do TikTok: ${res.status}`);
  }
  return res.json();
}

export async function saveTikTokTokens(tokens: TikTokTokens): Promise<void> {
  try {
    await put(TOKENS_PATHNAME, JSON.stringify(tokens), {
      access: 'private',
      addRandomSuffix: false,
      allowOverwrite: true,
      contentType: 'application/json',
      token: process.env.BLOB_READ_WRITE_TOKEN,
    });
  } catch (err) {
    throw new Error(`Falha ao salvar token do TikTok: ${(err as Error).message}`);
  }
}
