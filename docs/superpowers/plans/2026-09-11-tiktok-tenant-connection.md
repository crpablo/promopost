# Conexão TikTok por Tenant (Peça 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deixar cada empresa cadastrada conectar sua própria conta do TikTok pelo `/dashboard`, com o token isolado por `business_id` numa nova tabela, sem tocar no fluxo interno existente (Tobie Store).

**Architecture:** Duas rotas novas (`/api/tiktok/connect`, `/api/tiktok/callback`) implementam o handshake OAuth com proteção CSRF via cookie de `state`; reaproveitam `exchangeTikTokToken()` já existente (`src/lib/social/tiktokTokenStore.ts`) só pra troca de código por token, e persistem em uma tabela nova (`tiktok_accounts`) via um módulo de acesso a dados no padrão de `src/lib/db/businesses.ts`. `/dashboard` passa a consultar essa tabela pra decidir entre mostrar "Conectar TikTok" ou "TikTok conectado ✅".

**Tech Stack:** Next.js App Router (existente), Postgres (existente, ver `docs/superpowers/plans/2026-09-08-multitenant-foundation.md`), Auth.js (`@/auth`, existente), Vitest.

## Global Constraints

- Não modifica `src/app/api/tiktok-oauth-callback/route.ts`, `src/lib/social/tiktokTokenStore.ts` (o arquivo de persistência do fluxo interno continua o mesmo), `src/lib/social/tiktok.ts` nem `src/app/api/webhook/route.ts` — o pipeline automático de postagem continua rodando só pra Tobie Store, sem plugar a conta recém-conectada de um tenant (isso é peça futura).
- Reaproveita `TIKTOK_CLIENT_KEY`/`TIKTOK_CLIENT_SECRET` já configurados (mesmo app TikTok, Sandbox). Usa uma env var nova, `TIKTOK_TENANT_REDIRECT_URI`, diferente de `TIKTOK_REDIRECT_URI` (que continua exclusiva da rota interna) — as duas rotas de callback não podem compartilhar a mesma Redirect URI cadastrada no Developer Portal da TikTok.
- `tiktok_accounts.business_id` tem `unique` — "1 empresa, 1 conta TikTok" a nível de banco, mesmo padrão de `businesses.owner_user_id`. Reconectar é upsert; sem botão de desconectar nesta fase (decisão do spec).
- Rotas novas usam `Pool` via `getPool()` (`src/lib/db/pool.ts`, já existe da fundação) — não cria conexão própria.
- Inline styles only, no CSS framework — mesmo padrão de toda página existente (`src/app/(app)/dashboard/page.tsx`, `src/app/login/page.tsx`).
- Testes de rota seguem o padrão já usado em `src/app/api/tiktok-oauth-callback/route.test.ts`: construir um `Request` puro e chamar `GET()` diretamente, mockando módulos com `vi.mock`/`vi.hoisted` — não usar `next/headers` (`cookies()`) nas rotas novas porque essa API depende do contexto de request do Next em produção e quebra quando a rota é chamada diretamente num teste; ler/escrever cookies via `Request.headers`/`NextResponse.cookies` (que não dependem desse contexto).

---

### Task 1: Migration `tiktok_accounts` + módulo de acesso a dados + deploy.sh aplicando todas as migrations

**Files:**
- Create: `db/migrations/002_tiktok_accounts.sql`
- Create: `src/lib/db/tiktokAccounts.ts`
- Test: `src/lib/db/tiktokAccounts.test.ts`
- Modify: `deploy.sh`

**Interfaces:**
- Consumes: `Pool` type de `pg` (já usado por `src/lib/db/businesses.ts`).
- Produces:
  - `interface TikTokAccount { businessId: string; accessToken: string; refreshToken: string; expiresAt: Date; connectedAt: Date }`
  - `interface TikTokTokensInput { accessToken: string; refreshToken: string; expiresAt: Date }`
  - `getTikTokAccountForBusiness(pool: Pool, businessId: string): Promise<TikTokAccount | null>`
  - `saveTikTokAccountForBusiness(pool: Pool, businessId: string, tokens: TikTokTokensInput): Promise<TikTokAccount>` (upsert)

  Task 3 (rota de callback) e Task 4 (dashboard) chamam essas duas funções com o `pool` de `getPool()`.

- [ ] **Step 1: Escrever os testes que devem falhar**

```typescript
// src/lib/db/tiktokAccounts.test.ts
import { describe, expect, it, vi } from 'vitest';
import { getTikTokAccountForBusiness, saveTikTokAccountForBusiness } from './tiktokAccounts';

function makePool(rows: unknown[]) {
  return { query: vi.fn().mockResolvedValue({ rows }) } as unknown as import('pg').Pool;
}

describe('getTikTokAccountForBusiness', () => {
  it('retorna null quando a empresa não tem conta TikTok conectada', async () => {
    const pool = makePool([]);
    const result = await getTikTokAccountForBusiness(pool, 'biz-1');
    expect(result).toBeNull();
    expect(pool.query).toHaveBeenCalledWith(
      'select business_id, access_token, refresh_token, expires_at, connected_at from tiktok_accounts where business_id = $1',
      ['biz-1'],
    );
  });

  it('retorna a conta quando existe', async () => {
    const expiresAt = new Date('2026-09-12T12:00:00Z');
    const connectedAt = new Date('2026-09-11T12:00:00Z');
    const pool = makePool([
      { business_id: '7', access_token: 'at', refresh_token: 'rt', expires_at: expiresAt, connected_at: connectedAt },
    ]);
    const result = await getTikTokAccountForBusiness(pool, '7');
    expect(result).toEqual({
      businessId: '7',
      accessToken: 'at',
      refreshToken: 'rt',
      expiresAt,
      connectedAt,
    });
  });
});

describe('saveTikTokAccountForBusiness', () => {
  it('insere/atualiza (upsert) e retorna a conta salva', async () => {
    const expiresAt = new Date('2026-09-12T12:00:00Z');
    const connectedAt = new Date('2026-09-11T12:00:00Z');
    const pool = makePool([
      {
        business_id: '9',
        access_token: 'new-at',
        refresh_token: 'new-rt',
        expires_at: expiresAt,
        connected_at: connectedAt,
      },
    ]);
    const result = await saveTikTokAccountForBusiness(pool, '9', {
      accessToken: 'new-at',
      refreshToken: 'new-rt',
      expiresAt,
    });
    expect(result).toEqual({
      businessId: '9',
      accessToken: 'new-at',
      refreshToken: 'new-rt',
      expiresAt,
      connectedAt,
    });
    expect(pool.query).toHaveBeenCalledWith(expect.stringContaining('insert into tiktok_accounts'), [
      '9',
      'new-at',
      'new-rt',
      expiresAt,
    ]);
  });
});
```

- [ ] **Step 2: Rodar os testes e confirmar que falham**

Run: `npx vitest run src/lib/db/tiktokAccounts.test.ts`
Expected: FAIL — `Cannot find module './tiktokAccounts'`

- [ ] **Step 3: Escrever a migration**

Create `db/migrations/002_tiktok_accounts.sql`:

```sql
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
```

- [ ] **Step 4: Escrever a implementação**

```typescript
// src/lib/db/tiktokAccounts.ts
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
```

- [ ] **Step 5: Rodar os testes e confirmar que passam**

Run: `npx vitest run src/lib/db/tiktokAccounts.test.ts`
Expected: PASS (3 testes)

- [ ] **Step 6: Fazer o `deploy.sh` aplicar todas as migrations, não só a primeira**

Ler `deploy.sh` atual primeiro (`cat deploy.sh`) pra confirmar a linha exata antes de editar — hoje ele aplica só `db/migrations/001_init.sql` hardcoded, o que faria a migration nova (`002_tiktok_accounts.sql`) nunca rodar em produção. Substituir a linha:

```bash
docker compose exec -T db psql -U promopost -d promopost < db/migrations/001_init.sql
```

por:

```bash
for f in db/migrations/*.sql; do
  docker compose exec -T db psql -U promopost -d promopost < "$f"
done
```

(mantém o comentário acima da linha, que já explica a idempotência via `create if not exists`)

- [ ] **Step 7: Rodar o typecheck**

Run: `npm run typecheck`
Expected: sem erros

- [ ] **Step 8: Commit**

```bash
git add db/migrations/002_tiktok_accounts.sql src/lib/db/tiktokAccounts.ts src/lib/db/tiktokAccounts.test.ts deploy.sh
git commit -m "feat: adiciona tabela e acesso a dados de contas TikTok por tenant"
```

---

### Task 2: Rota `/api/tiktok/connect`

**Files:**
- Create: `src/app/api/tiktok/connect/route.ts`
- Test: `src/app/api/tiktok/connect/route.test.ts`

**Interfaces:**
- Consumes: `auth` de `@/auth` (Task 3 da fundação multi-tenant, já existe).
- Produces: rota `GET /api/tiktok/connect` que redireciona (307) pra `/login` sem sessão, ou pra URL de autorização da TikTok com um cookie `tiktok_oauth_state` setado. Task 3 (rota de callback) lê esse mesmo cookie pra validar o `state`.

- [ ] **Step 1: Escrever os testes que devem falhar**

```typescript
// src/app/api/tiktok/connect/route.test.ts
import { afterEach, describe, expect, it, vi } from 'vitest';

const { authMock } = vi.hoisted(() => ({ authMock: vi.fn() }));

vi.mock('@/auth', () => ({ auth: authMock }));

import { GET } from './route';

function stubEnv() {
  vi.stubEnv('TIKTOK_CLIENT_KEY', 'fake-client-key');
  vi.stubEnv('TIKTOK_TENANT_REDIRECT_URI', 'https://promopost.example.com/api/tiktok/callback');
}

describe('GET /api/tiktok/connect', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it('sem sessão, redireciona para /login', async () => {
    authMock.mockResolvedValue(null);
    const request = new Request('https://promopost.example.com/api/tiktok/connect');
    const response = await GET(request);
    expect(response.headers.get('location')).toBe('https://promopost.example.com/login');
  });

  it('com sessão, redireciona pra URL de autorização da TikTok e seta o cookie de state', async () => {
    stubEnv();
    authMock.mockResolvedValue({ user: { id: 'user-1' } });
    const request = new Request('https://promopost.example.com/api/tiktok/connect');
    const response = await GET(request);

    const location = response.headers.get('location');
    expect(location).toContain('https://www.tiktok.com/v2/auth/authorize/?');
    expect(location).toContain('client_key=fake-client-key');
    expect(location).toContain('scope=user.info.basic%2Cvideo.publish');
    expect(location).toContain(
      'redirect_uri=https%3A%2F%2Fpromopost.example.com%2Fapi%2Ftiktok%2Fcallback',
    );

    const setCookie = response.headers.get('set-cookie');
    expect(setCookie).toContain('tiktok_oauth_state=');
    expect(setCookie).toMatch(/HttpOnly/i);
  });

  it('retorna 500 quando faltam as env vars do TikTok', async () => {
    authMock.mockResolvedValue({ user: { id: 'user-1' } });
    const request = new Request('https://promopost.example.com/api/tiktok/connect');
    const response = await GET(request);
    expect(response.status).toBe(500);
  });
});
```

- [ ] **Step 2: Rodar os testes e confirmar que falham**

Run: `npx vitest run src/app/api/tiktok/connect/route.test.ts`
Expected: FAIL — `Cannot find module './route'`

- [ ] **Step 3: Escrever a implementação**

```typescript
// src/app/api/tiktok/connect/route.ts
import { NextResponse } from 'next/server';
import { auth } from '@/auth';

const STATE_COOKIE = 'tiktok_oauth_state';
const STATE_COOKIE_MAX_AGE_SECONDS = 10 * 60;

export async function GET(request: Request): Promise<Response> {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.redirect(new URL('/login', request.url));
  }

  const clientKey = process.env.TIKTOK_CLIENT_KEY;
  const redirectUri = process.env.TIKTOK_TENANT_REDIRECT_URI;
  if (!clientKey || !redirectUri) {
    return new Response('Variáveis de ambiente do TikTok ausentes no servidor', { status: 500 });
  }

  const state = crypto.randomUUID();
  const params = new URLSearchParams({
    client_key: clientKey,
    response_type: 'code',
    scope: 'user.info.basic,video.publish',
    redirect_uri: redirectUri,
    state,
  });

  const response = NextResponse.redirect(`https://www.tiktok.com/v2/auth/authorize/?${params.toString()}`);
  response.cookies.set(STATE_COOKIE, state, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    maxAge: STATE_COOKIE_MAX_AGE_SECONDS,
    path: '/',
  });
  return response;
}
```

- [ ] **Step 4: Rodar os testes e confirmar que passam**

Run: `npx vitest run src/app/api/tiktok/connect/route.test.ts`
Expected: PASS (3 testes)

- [ ] **Step 5: Commit**

```bash
git add src/app/api/tiktok/connect
git commit -m "feat: adiciona rota de inicio do OAuth do TikTok por tenant"
```

---

### Task 3: Rota `/api/tiktok/callback`

**Files:**
- Create: `src/app/api/tiktok/callback/route.ts`
- Test: `src/app/api/tiktok/callback/route.test.ts`

**Interfaces:**
- Consumes: `auth` de `@/auth`; `exchangeTikTokToken` de `@/lib/social/tiktokTokenStore` (já existe); `getBusinessForUser` de `@/lib/db/businesses` (já existe); `saveTikTokAccountForBusiness` de `@/lib/db/tiktokAccounts` (Task 1); `getPool` de `@/lib/db/pool` (já existe); cookie `tiktok_oauth_state` setado pela Task 2.
- Produces: rota `GET /api/tiktok/callback` que, em qualquer falha, redireciona pra `/dashboard?tiktok_error=1`; em sucesso, redireciona pra `/dashboard`. Task 4 (dashboard) lê `tiktok_error` da query string.

- [ ] **Step 1: Escrever os testes que devem falhar**

```typescript
// src/app/api/tiktok/callback/route.test.ts
import { afterEach, describe, expect, it, vi } from 'vitest';

const { authMock, exchangeTikTokTokenMock, getBusinessForUserMock, saveTikTokAccountForBusinessMock } = vi.hoisted(
  () => ({
    authMock: vi.fn(),
    exchangeTikTokTokenMock: vi.fn(),
    getBusinessForUserMock: vi.fn(),
    saveTikTokAccountForBusinessMock: vi.fn(),
  }),
);

vi.mock('@/auth', () => ({ auth: authMock }));
vi.mock('@/lib/social/tiktokTokenStore', () => ({ exchangeTikTokToken: exchangeTikTokTokenMock }));
vi.mock('@/lib/db/businesses', () => ({ getBusinessForUser: getBusinessForUserMock }));
vi.mock('@/lib/db/tiktokAccounts', () => ({ saveTikTokAccountForBusiness: saveTikTokAccountForBusinessMock }));
vi.mock('@/lib/db/pool', () => ({ getPool: vi.fn(() => ({})) }));

import { GET } from './route';

function stubEnv() {
  vi.stubEnv('TIKTOK_TENANT_REDIRECT_URI', 'https://promopost.example.com/api/tiktok/callback');
}

function makeRequest(url: string, cookieState?: string): Request {
  const headers = new Headers();
  if (cookieState) headers.set('cookie', `tiktok_oauth_state=${cookieState}`);
  return new Request(url, { headers });
}

describe('GET /api/tiktok/callback', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it('sem sessão, redireciona para /login', async () => {
    authMock.mockResolvedValue(null);
    const request = makeRequest('https://promopost.example.com/api/tiktok/callback?code=abc&state=xyz', 'xyz');
    const response = await GET(request);
    expect(response.headers.get('location')).toBe('https://promopost.example.com/login');
  });

  it('troca o código, salva a conta vinculada à business e redireciona pro dashboard', async () => {
    stubEnv();
    authMock.mockResolvedValue({ user: { id: 'user-1' } });
    exchangeTikTokTokenMock.mockResolvedValue({ accessToken: 'at', refreshToken: 'rt', expiresAt: 1234567890000 });
    getBusinessForUserMock.mockResolvedValue({
      id: 'biz-1',
      ownerUserId: 'user-1',
      name: 'Loja',
      createdAt: new Date(),
    });
    saveTikTokAccountForBusinessMock.mockResolvedValue({});

    const request = makeRequest('https://promopost.example.com/api/tiktok/callback?code=abc&state=xyz', 'xyz');
    const response = await GET(request);

    expect(exchangeTikTokTokenMock).toHaveBeenCalledWith({
      grant_type: 'authorization_code',
      code: 'abc',
      redirect_uri: 'https://promopost.example.com/api/tiktok/callback',
    });
    expect(saveTikTokAccountForBusinessMock).toHaveBeenCalledWith(expect.anything(), 'biz-1', {
      accessToken: 'at',
      refreshToken: 'rt',
      expiresAt: new Date(1234567890000),
    });
    expect(response.headers.get('location')).toBe('https://promopost.example.com/dashboard');
  });

  it('quando a TikTok manda error, redireciona pro dashboard com tiktok_error=1', async () => {
    authMock.mockResolvedValue({ user: { id: 'user-1' } });
    const request = makeRequest('https://promopost.example.com/api/tiktok/callback?error=access_denied');
    const response = await GET(request);
    expect(response.headers.get('location')).toBe('https://promopost.example.com/dashboard?tiktok_error=1');
    expect(exchangeTikTokTokenMock).not.toHaveBeenCalled();
  });

  it('quando o state não bate com o cookie, redireciona pro dashboard com tiktok_error=1', async () => {
    authMock.mockResolvedValue({ user: { id: 'user-1' } });
    const request = makeRequest(
      'https://promopost.example.com/api/tiktok/callback?code=abc&state=xyz',
      'diferente',
    );
    const response = await GET(request);
    expect(response.headers.get('location')).toBe('https://promopost.example.com/dashboard?tiktok_error=1');
    expect(exchangeTikTokTokenMock).not.toHaveBeenCalled();
  });

  it('quando falta o cookie de state, redireciona pro dashboard com tiktok_error=1', async () => {
    authMock.mockResolvedValue({ user: { id: 'user-1' } });
    const request = makeRequest('https://promopost.example.com/api/tiktok/callback?code=abc&state=xyz');
    const response = await GET(request);
    expect(response.headers.get('location')).toBe('https://promopost.example.com/dashboard?tiktok_error=1');
  });

  it('quando a troca de token falha, redireciona pro dashboard com tiktok_error=1', async () => {
    stubEnv();
    authMock.mockResolvedValue({ user: { id: 'user-1' } });
    exchangeTikTokTokenMock.mockRejectedValue(new Error('Falha ao trocar token do TikTok: boom'));
    const request = makeRequest('https://promopost.example.com/api/tiktok/callback?code=abc&state=xyz', 'xyz');
    const response = await GET(request);
    expect(response.headers.get('location')).toBe('https://promopost.example.com/dashboard?tiktok_error=1');
    expect(saveTikTokAccountForBusinessMock).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Rodar os testes e confirmar que falham**

Run: `npx vitest run src/app/api/tiktok/callback/route.test.ts`
Expected: FAIL — `Cannot find module './route'`

- [ ] **Step 3: Escrever a implementação**

```typescript
// src/app/api/tiktok/callback/route.ts
import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { exchangeTikTokToken } from '@/lib/social/tiktokTokenStore';
import { getBusinessForUser } from '@/lib/db/businesses';
import { saveTikTokAccountForBusiness } from '@/lib/db/tiktokAccounts';
import { getPool } from '@/lib/db/pool';

const STATE_COOKIE = 'tiktok_oauth_state';

function readCookie(request: Request, name: string): string | undefined {
  const header = request.headers.get('cookie');
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return rest.join('=');
  }
  return undefined;
}

export async function GET(request: Request): Promise<Response> {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.redirect(new URL('/login', request.url));
  }

  const { searchParams } = new URL(request.url);
  const error = searchParams.get('error');
  const code = searchParams.get('code');
  const state = searchParams.get('state');
  const cookieState = readCookie(request, STATE_COOKIE);

  function failResponse(): Response {
    const response = NextResponse.redirect(new URL('/dashboard?tiktok_error=1', request.url));
    response.cookies.delete(STATE_COOKIE);
    return response;
  }

  if (error || !code || !state || !cookieState || state !== cookieState) {
    return failResponse();
  }

  const redirectUri = process.env.TIKTOK_TENANT_REDIRECT_URI;
  if (!redirectUri) {
    return new Response('Variáveis de ambiente do TikTok ausentes no servidor', { status: 500 });
  }

  try {
    const tokens = await exchangeTikTokToken({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
    });
    const business = await getBusinessForUser(getPool(), session.user.id);
    if (!business) {
      return failResponse();
    }
    await saveTikTokAccountForBusiness(getPool(), business.id, {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresAt: new Date(tokens.expiresAt),
    });
  } catch {
    return failResponse();
  }

  const response = NextResponse.redirect(new URL('/dashboard', request.url));
  response.cookies.delete(STATE_COOKIE);
  return response;
}
```

- [ ] **Step 4: Rodar os testes e confirmar que passam**

Run: `npx vitest run src/app/api/tiktok/callback/route.test.ts`
Expected: PASS (6 testes)

- [ ] **Step 5: Commit**

```bash
git add src/app/api/tiktok/callback
git commit -m "feat: adiciona rota de callback do OAuth do TikTok por tenant"
```

---

### Task 4: Dashboard mostra status da conexão + documentação

**Files:**
- Modify: `src/app/(app)/dashboard/page.tsx`
- Modify: `.env.example`
- Modify: `docs/runbook.md`

**Interfaces:**
- Consumes: `getTikTokAccountForBusiness` de `@/lib/db/tiktokAccounts` (Task 1); rotas `/api/tiktok/connect` (Task 2), `tiktok_error` query param (Task 3).
- Produces: nada — task terminal deste plano.

- [ ] **Step 1: Atualizar o dashboard**

Substituir o conteúdo de `src/app/(app)/dashboard/page.tsx` (o arquivo atual tem `Business.id` como `string`, `getBusinessForUser` e o botão desabilitado "Conectar TikTok (em breve)" — ler o arquivo primeiro pra confirmar antes de editar) por:

```typescript
import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { getPool } from '@/lib/db/pool';
import { getBusinessForUser } from '@/lib/db/businesses';
import { getTikTokAccountForBusiness } from '@/lib/db/tiktokAccounts';

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ tiktok_error?: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) {
    redirect('/login');
  }

  const business = await getBusinessForUser(getPool(), session.user.id);
  if (!business) {
    redirect('/onboarding');
  }

  const tiktokAccount = await getTikTokAccountForBusiness(getPool(), business.id);
  const { tiktok_error } = await searchParams;

  return (
    <main style={{ maxWidth: 640, margin: '0 auto', padding: '48px 24px', lineHeight: 1.6 }}>
      <h1>Bem-vindo, {business.name}</h1>
      {tiktok_error && (
        <p style={{ color: '#b00020', marginBottom: 12 }}>
          Não foi possível conectar sua conta do TikTok. Tente novamente em alguns instantes.
        </p>
      )}
      {tiktokAccount ? (
        <>
          <p>TikTok conectado ✅</p>
          <a href="/api/tiktok/connect" style={{ display: 'inline-block', padding: 12 }}>
            Reconectar
          </a>
        </>
      ) : (
        <a href="/api/tiktok/connect" style={{ display: 'inline-block', padding: 12 }}>
          Conectar TikTok
        </a>
      )}
    </main>
  );
}
```

- [ ] **Step 2: Documentar a env var nova em `.env.example`**

Adicionar logo após o bloco existente de `TIKTOK_REDIRECT_URI` (entre as linhas `TIKTOK_REDIRECT_URI=` e o bloco da Shopee):

```
# URL pública de callback do OAuth por tenant (fluxo self-service em
# /dashboard, diferente do fluxo interno acima) — precisa ser cadastrada
# como uma Redirect URI adicional no mesmo app da TikTok.
# Ex: https://promopost.tobiestore.com.br/api/tiktok/callback
TIKTOK_TENANT_REDIRECT_URI=
```

- [ ] **Step 3: Documentar no runbook**

Adicionar ao final de `docs/runbook.md` (depois da seção 13.3 existente):

```markdown

### 13.4 Conexão de TikTok por tenant (Peça 2)

Cada empresa cadastrada pode conectar sua própria conta do TikTok em `/dashboard` (botão "Conectar TikTok"), token guardado na tabela `tiktok_accounts` — ver spec em `docs/superpowers/specs/2026-09-11-tiktok-tenant-connection-design.md`. Não afeta o fluxo interno da Tobie Store (continua usando `tiktok-tokens.json`) nem o pipeline automático de postagem, que ainda não usa essas contas.

**Setup necessário (uma vez):**
1. No TikTok Developer Portal, cadastre uma **Redirect URI adicional** no mesmo app: `https://promopost.tobiestore.com.br/api/tiktok/callback`.
2. Defina `TIKTOK_TENANT_REDIRECT_URI` no `.env` da VPS com essa mesma URL.
3. Reaproveita `TIKTOK_CLIENT_KEY`/`TIKTOK_CLIENT_SECRET` já configurados — nenhuma credencial nova.

**Sandbox ainda restringe quem consegue autorizar:** enquanto o app não for aprovado pra Produção (ver [[promopost-tiktok-setup-pending]] na memória — a submissão de 2026-08-27 foi rejeitada), só contas cadastradas manualmente como "Target Users" no Developer Portal conseguem completar o OAuth. Pra testar este fluxo com uma segunda empresa/conta, adicione essa conta como target user lá primeiro.
```

Também corrigir a nota da seção 13 (topo), que hoje diz que o Resend "ainda não foi provisionado" — isso já foi resolvido (domínio `mail.tobiestore.com.br` verificado, ver memória `promopost-multitenant-foundation-live`). Localizar o parágrafo que começa com **"Bloqueado até alguém provisionar Resend:"** logo no início da seção 13 e substituí-lo por:

```markdown
**Resend configurado:** domínio de envio verificado é `mail.tobiestore.com.br` (`EMAIL_FROM=PromoPost <login@mail.tobiestore.com.br>`). `RESEND_API_KEY` está no `.env` da VPS.
```

- [ ] **Step 4: Rodar o typecheck e a suíte completa de testes**

Run: `npm run typecheck && npx vitest run`
Expected: typecheck sem erros; todos os testes passando (os já existentes + os 9 novos desta plan)

- [ ] **Step 5: Verificar manualmente o fluxo completo**

Pré-requisito: ter feito o setup do Step 3 acima (Redirect URI cadastrada na TikTok, `TIKTOK_TENANT_REDIRECT_URI` no `.env`) e ter uma conta TikTok cadastrada como Target User no Sandbox.

1. `npm run dev` (ou testar já em produção depois do deploy).
2. Logado como uma empresa sem TikTok conectado, abrir `/dashboard` → confirmar que mostra o link "Conectar TikTok".
3. Clicar nele → confirmar que vai pra tela de autorização da TikTok.
4. Autorizar (com uma conta cadastrada como Target User) → confirmar que volta pra `/dashboard` mostrando "TikTok conectado ✅" e o link "Reconectar".
5. Clicar em "Reconectar" e autorizar de novo → confirmar que continua mostrando "TikTok conectado ✅" (upsert funcionou, sem duplicar linha — pode conferir com `docker compose exec db psql -U promopost -d promopost -c 'select count(*) from tiktok_accounts;'`, deve continuar 1).
6. Forçar um erro (ex: negar a autorização na tela da TikTok) → confirmar que volta pra `/dashboard?tiktok_error=1` mostrando a mensagem de erro.

- [ ] **Step 6: Commit**

```bash
git add "src/app/(app)/dashboard/page.tsx" .env.example docs/runbook.md
git commit -m "feat: mostra status da conexao TikTok no dashboard e documenta setup"
```
