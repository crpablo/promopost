-- PromoPost: conta do TikTok conectada por tenant (Peça 2 do pivot
-- multi-tenant). Não afeta o fluxo interno da Tobie Store, que continua
-- usando o arquivo tiktok-tokens.json via src/lib/social/tiktokTokenStore.ts.
create table if not exists tiktok_accounts (
  business_id    bigint not null unique references businesses(id) on delete cascade,
  access_token   text not null,
  refresh_token  text not null,
  expires_at     timestamptz not null,
  connected_at   timestamptz not null default now()
);
