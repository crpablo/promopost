import type { Pool } from 'pg';

export interface TikTokAccount {
  businessId: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
  connectedAt: Date;
}

export interface TikTokTokensInput {
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
}

function toTikTokAccount(row: {
  business_id: string;
  access_token: string;
  refresh_token: string;
  expires_at: Date;
  connected_at: Date;
}): TikTokAccount {
  return {
    businessId: row.business_id,
    accessToken: row.access_token,
    refreshToken: row.refresh_token,
    expiresAt: row.expires_at,
    connectedAt: row.connected_at,
  };
}

export async function getTikTokAccountForBusiness(
  pool: Pool,
  businessId: string,
): Promise<TikTokAccount | null> {
  const result = await pool.query(
    'select business_id, access_token, refresh_token, expires_at, connected_at from tiktok_accounts where business_id = $1',
    [businessId],
  );
  const row = result.rows[0];
  return row ? toTikTokAccount(row) : null;
}

export async function saveTikTokAccountForBusiness(
  pool: Pool,
  businessId: string,
  tokens: TikTokTokensInput,
): Promise<TikTokAccount> {
  const result = await pool.query(
    `insert into tiktok_accounts (business_id, access_token, refresh_token, expires_at)
     values ($1, $2, $3, $4)
     on conflict (business_id) do update set
       access_token = excluded.access_token,
       refresh_token = excluded.refresh_token,
       expires_at = excluded.expires_at
     returning business_id, access_token, refresh_token, expires_at, connected_at`,
    [businessId, tokens.accessToken, tokens.refreshToken, tokens.expiresAt],
  );
  return toTikTokAccount(result.rows[0]);
}
