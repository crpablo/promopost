import type { Pool } from 'pg';
import { getTikTokAccountForBusiness, saveTikTokAccountForBusiness } from '@/lib/db/tiktokAccounts';
import { exchangeTikTokToken } from './tiktokTokenStore';

// Mesma margem de segurança usada em getValidAccessToken() (src/lib/social/tiktok.ts).
const TOKEN_REFRESH_MARGIN_MS = 5 * 60 * 1000;

export async function getValidAccessTokenForBusiness(pool: Pool, businessId: string): Promise<string> {
  const account = await getTikTokAccountForBusiness(pool, businessId);
  if (!account) {
    throw new Error('Conta do TikTok não conectada');
  }

  if (Date.now() < account.expiresAt.getTime() - TOKEN_REFRESH_MARGIN_MS) {
    return account.accessToken;
  }

  let refreshed;
  try {
    refreshed = await exchangeTikTokToken({
      grant_type: 'refresh_token',
      refresh_token: account.refreshToken,
    });
  } catch (err) {
    throw new Error(`Falha ao renovar token do TikTok: ${(err as Error).message}`);
  }

  await saveTikTokAccountForBusiness(pool, businessId, {
    accessToken: refreshed.accessToken,
    refreshToken: refreshed.refreshToken,
    expiresAt: new Date(refreshed.expiresAt),
  });

  return refreshed.accessToken;
}
