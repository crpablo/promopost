-- Auth.js (next-auth v5) Postgres adapter schema — required table/column
-- names and casing, do not rename (the adapter queries these verbatim).
create table if not exists users (
  id uuid default gen_random_uuid() primary key,
  name text,
  email text unique,
  "emailVerified" timestamptz,
  image text
);

create table if not exists accounts (
  id uuid default gen_random_uuid() primary key,
  "userId" uuid not null references users(id) on delete cascade,
  type text not null,
  provider text not null,
  "providerAccountId" text not null,
  refresh_token text,
  access_token text,
  expires_at bigint,
  token_type text,
  scope text,
  id_token text,
  session_state text,
  unique (provider, "providerAccountId")
);

create table if not exists sessions (
  id uuid default gen_random_uuid() primary key,
  "userId" uuid not null references users(id) on delete cascade,
  expires timestamptz not null,
  "sessionToken" text not null unique
);

create table if not exists verification_token (
  identifier text not null,
  token text not null,
  expires timestamptz not null,
  primary key (identifier, token)
);

create index if not exists accounts_user_id_idx on accounts("userId");
create index if not exists sessions_user_id_idx on sessions("userId");

-- PromoPost: one business (tenant) per user. The `unique` on owner_user_id
-- is what enforces "1 user = 1 business" — see design doc.
create table if not exists businesses (
  id bigint generated always as identity primary key,
  owner_user_id uuid not null unique references users(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now()
);
