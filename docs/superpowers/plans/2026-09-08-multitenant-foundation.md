# Fundação Multi-Tenant Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add real company signup/login to PromoPost (Postgres + Auth.js magic-link auth + a `businesses` table), laid out so the next piece (per-tenant TikTok connection) can build directly on top of it.

**Architecture:** A new self-hosted Postgres service (Docker, same VPS) backs Auth.js v5 (`next-auth@beta`) via its Postgres adapter, using a magic-link-only email provider (Resend for delivery). A new, isolated `src/app/(app)/...` route group holds `/login`, `/onboarding`, and `/dashboard` — none of it touches the existing automation routes (`/api/webhook`, `/admin`, `/api/tiktok-*`, etc.), which keep running unchanged.

**Tech Stack:** Next.js App Router (existing), Postgres 16 (new), `next-auth@beta` + `@auth/pg-adapter` (new), `resend` (new), `pg` (new), Vitest for the testable pieces (existing convention).

## Global Constraints

- Postgres is self-hosted via Docker on the same VPS (`46.202.147.12`) — not Supabase, not a managed service. See `docs/superpowers/specs/2026-09-03-multitenant-foundation-design.md`.
- Auth.js v5 with the Postgres adapter, `session: { strategy: 'database' }`. Magic link only — no password field anywhere.
- `businesses.owner_user_id` has a `unique` constraint — this is what enforces "1 user = 1 business" at the database level (per spec, no team/multi-user-per-business support in this phase).
- New authenticated surface lives under `src/app/(app)/...` (route group — doesn't affect URLs). Do not modify `src/app/api/webhook/`, `src/app/admin/`, `src/app/api/admin/`, `src/app/api/tiktok-*`, or any other existing route in this plan.
- Inline styles only, no CSS framework — matches every existing page (`src/app/page.tsx`, `src/app/politica-de-privacidade/page.tsx`, `src/app/admin/page.tsx`).
- The VPS now also hosts an unrelated second project (`corretor-milionario`) on its own container/nginx site — don't assume exclusive use of host resources when sizing anything, and don't touch nginx config for anything other than PromoPost's own site.

---

### Task 1: Postgres service, schema migration, connection pool

**Files:**
- Modify: `docker-compose.yml`
- Modify: `.env.example`
- Create: `db/migrations/001_init.sql`
- Create: `src/lib/db/pool.ts`

**Interfaces:**
- Produces: `getPool(): Pool` (from `pg`) in `src/lib/db/pool.ts` — a lazily-created, module-level singleton. Task 2 (`businesses.ts`) and Task 3 (`auth.ts`) both call this to get their database handle. `Pool` here is the class exported by the `pg` package.

No automated test for this task — it's infrastructure (Docker service + raw SQL + a connection singleton). Verified manually per Step 6 below, consistent with how non-testable infra/UI tasks are handled elsewhere in this project (e.g. `docs/superpowers/plans/2026-08-27-tiktok-admin-demo.md` Task 2).

- [ ] **Step 1: Add the `db` service to `docker-compose.yml`**

Replace the full contents of `docker-compose.yml` with:

```yaml
services:
  app:
    build: .
    restart: unless-stopped
    env_file:
      - .env
    environment:
      - DATA_DIR=/data
    volumes:
      - ./data:/data
    ports:
      - "127.0.0.1:3000:3000"
    depends_on:
      - db

  db:
    image: postgres:16-alpine
    restart: unless-stopped
    environment:
      - POSTGRES_USER=promopost
      - POSTGRES_DB=promopost
      - POSTGRES_PASSWORD=${POSTGRES_PASSWORD}
    volumes:
      - db-data:/var/lib/postgresql/data
    ports:
      - "127.0.0.1:5432:5432"

volumes:
  db-data:
```

- [ ] **Step 2: Document the new env vars in `.env.example`**

Add these lines to `.env.example` (any position is fine; grouping with a comment header is nice but not required):

```
# Postgres self-hosted via Docker (ver docker-compose.yml, servico "db").
# POSTGRES_PASSWORD e a senha do container; DATABASE_URL precisa usar a MESMA senha.
POSTGRES_PASSWORD=
DATABASE_URL=postgresql://promopost:<mesma-senha-do-POSTGRES_PASSWORD-acima>@db:5432/promopost

# Auth.js (login das empresas) — gere com: openssl rand -hex 32
AUTH_SECRET=

# Resend (envio do magic link por email) — https://resend.com
RESEND_API_KEY=
EMAIL_FROM=PromoPost <login@promopost.tobiestore.com.br>
```

- [ ] **Step 3: Write the schema migration**

Create `db/migrations/001_init.sql`:

```sql
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
```

- [ ] **Step 4: Write the connection pool module**

Create `src/lib/db/pool.ts`:

```typescript
import { Pool } from 'pg';

let pool: Pool | undefined;

export function getPool(): Pool {
  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: 10,
    });
  }
  return pool;
}
```

- [ ] **Step 5: Install the `pg` dependency**

Run: `npm install pg && npm install -D @types/pg`
Expected: `pg` added to `dependencies`, `@types/pg` added to `devDependencies` in `package.json`.

- [ ] **Step 6: Manually verify the database comes up and the schema applies**

1. In `.env`, set `POSTGRES_PASSWORD` to a real value (e.g. `openssl rand -hex 24`) and set `DATABASE_URL` to match: `postgresql://promopost:<same-value>@db:5432/promopost`.
2. Run: `docker compose up -d db`
3. Run: `docker compose ps` — expected: `db` service is `Up` / `healthy`-ish (no health check defined, just confirm it's running, not restarting).
4. Apply the migration: `cat db/migrations/001_init.sql | docker compose exec -T db psql -U promopost -d promopost`
   Expected: a series of `CREATE TABLE`/`CREATE INDEX` (or `NOTICE: relation ... already exists, skipping` on a re-run) — no errors.
5. Confirm the tables exist: `docker compose exec -T db psql -U promopost -d promopost -c '\dt'`
   Expected: lists `users`, `accounts`, `sessions`, `verification_token`, `businesses`.
6. Run: `npm run typecheck` — expected: no errors (confirms `src/lib/db/pool.ts` compiles against the new `pg` types).

- [ ] **Step 7: Commit**

```bash
git add docker-compose.yml .env.example db/migrations/001_init.sql src/lib/db/pool.ts package.json package-lock.json
git commit -m "feat: adiciona Postgres self-hosted e schema inicial (Auth.js + businesses)"
```

---

### Task 2: `businesses` data access functions

**Files:**
- Create: `src/lib/db/businesses.ts`
- Test: `src/lib/db/businesses.test.ts`

**Interfaces:**
- Consumes: `Pool` type from `pg` (a `Pool`-like object with `.query(sql: string, params: unknown[]): Promise<{ rows: T[] }>` — the real `pg.Pool` from Task 1's `getPool()`, or a mock in tests).
- Produces:
  - `interface Business { id: number; ownerUserId: string; name: string; createdAt: Date }`
  - `getBusinessForUser(pool: Pool, userId: string): Promise<Business | null>`
  - `createBusinessForUser(pool: Pool, userId: string, name: string): Promise<Business>`

  Task 4's pages call both of these directly with the pool from `getPool()`.

- [ ] **Step 1: Write the failing tests**

```typescript
// src/lib/db/businesses.test.ts
import { describe, expect, it, vi } from 'vitest';
import { createBusinessForUser, getBusinessForUser } from './businesses';

function makePool(rows: unknown[]) {
  return { query: vi.fn().mockResolvedValue({ rows }) } as unknown as import('pg').Pool;
}

describe('getBusinessForUser', () => {
  it('retorna null quando o usuário não tem business', async () => {
    const pool = makePool([]);
    const result = await getBusinessForUser(pool, 'user-1');
    expect(result).toBeNull();
    expect(pool.query).toHaveBeenCalledWith(
      'select id, owner_user_id, name, created_at from businesses where owner_user_id = $1',
      ['user-1'],
    );
  });

  it('retorna a business quando existe', async () => {
    const createdAt = new Date('2026-09-08T12:00:00Z');
    const pool = makePool([
      { id: 7, owner_user_id: 'user-1', name: 'Tobie Store', created_at: createdAt },
    ]);
    const result = await getBusinessForUser(pool, 'user-1');
    expect(result).toEqual({ id: 7, ownerUserId: 'user-1', name: 'Tobie Store', createdAt });
  });
});

describe('createBusinessForUser', () => {
  it('insere e retorna a business criada', async () => {
    const createdAt = new Date('2026-09-08T12:00:00Z');
    const pool = makePool([
      { id: 9, owner_user_id: 'user-2', name: 'Loja Nova', created_at: createdAt },
    ]);
    const result = await createBusinessForUser(pool, 'user-2', 'Loja Nova');
    expect(result).toEqual({ id: 9, ownerUserId: 'user-2', name: 'Loja Nova', createdAt });
    expect(pool.query).toHaveBeenCalledWith(
      'insert into businesses (owner_user_id, name) values ($1, $2) returning id, owner_user_id, name, created_at',
      ['user-2', 'Loja Nova'],
    );
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/db/businesses.test.ts`
Expected: FAIL — `Cannot find module './businesses'` (file doesn't exist yet).

- [ ] **Step 3: Write the implementation**

```typescript
// src/lib/db/businesses.ts
import type { Pool } from 'pg';

export interface Business {
  id: number;
  ownerUserId: string;
  name: string;
  createdAt: Date;
}

function toBusiness(row: {
  id: number;
  owner_user_id: string;
  name: string;
  created_at: Date;
}): Business {
  return { id: row.id, ownerUserId: row.owner_user_id, name: row.name, createdAt: row.created_at };
}

export async function getBusinessForUser(pool: Pool, userId: string): Promise<Business | null> {
  const result = await pool.query(
    'select id, owner_user_id, name, created_at from businesses where owner_user_id = $1',
    [userId],
  );
  const row = result.rows[0];
  return row ? toBusiness(row) : null;
}

export async function createBusinessForUser(
  pool: Pool,
  userId: string,
  name: string,
): Promise<Business> {
  const result = await pool.query(
    'insert into businesses (owner_user_id, name) values ($1, $2) returning id, owner_user_id, name, created_at',
    [userId, name],
  );
  return toBusiness(result.rows[0]);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/lib/db/businesses.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add src/lib/db/businesses.ts src/lib/db/businesses.test.ts
git commit -m "feat: adiciona funcoes de acesso a dados de businesses"
```

---

### Task 3: Auth.js config, route handler, magic-link email via Resend

**Files:**
- Create: `src/auth.ts`
- Create: `src/app/api/auth/[...nextauth]/route.ts`
- Create: `src/lib/email/sendMagicLink.ts`
- Test: `src/lib/email/sendMagicLink.test.ts`

**Interfaces:**
- Consumes: `getPool()` from `src/lib/db/pool.ts` (Task 1).
- Produces:
  - `sendMagicLink({ to, url }: { to: string; url: string }): Promise<void>` from `src/lib/email/sendMagicLink.ts` — isolated so it's unit-testable without booting Auth.js.
  - `{ handlers, auth, signIn, signOut }` exported from `src/auth.ts` — Task 4's pages import `auth` (to read the session) and `signIn` (in the login form's server action).

- [ ] **Step 1: Write the failing test for the email-sending function**

```typescript
// src/lib/email/sendMagicLink.test.ts
import { afterEach, describe, expect, it, vi } from 'vitest';

const { sendMock } = vi.hoisted(() => ({ sendMock: vi.fn() }));

vi.mock('resend', () => ({
  Resend: vi.fn().mockImplementation(() => ({ emails: { send: sendMock } })),
}));

import { sendMagicLink } from './sendMagicLink';

describe('sendMagicLink', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it('envia o email via Resend com o link e o remetente configurado', async () => {
    vi.stubEnv('RESEND_API_KEY', 'fake-key');
    vi.stubEnv('EMAIL_FROM', 'PromoPost <login@promopost.tobiestore.com.br>');
    sendMock.mockResolvedValue({ data: { id: 'email-1' }, error: null });

    await sendMagicLink({ to: 'dono@loja.com', url: 'https://promopost.tobiestore.com.br/api/auth/callback/nodemailer?token=abc' });

    expect(sendMock).toHaveBeenCalledWith(
      expect.objectContaining({
        from: 'PromoPost <login@promopost.tobiestore.com.br>',
        to: 'dono@loja.com',
        subject: 'Seu link de acesso ao PromoPost',
      }),
    );
    const call = sendMock.mock.calls[0][0];
    expect(call.html).toContain('https://promopost.tobiestore.com.br/api/auth/callback/nodemailer?token=abc');
  });

  it('lança erro quando o Resend retorna erro', async () => {
    vi.stubEnv('RESEND_API_KEY', 'fake-key');
    sendMock.mockResolvedValue({ data: null, error: { message: 'domínio não verificado' } });

    await expect(
      sendMagicLink({ to: 'dono@loja.com', url: 'https://x.com/callback' }),
    ).rejects.toThrow('Falha ao enviar email de login: domínio não verificado');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/lib/email/sendMagicLink.test.ts`
Expected: FAIL — `Cannot find module './sendMagicLink'`

- [ ] **Step 3: Install `resend` and `next-auth@beta` / `@auth/pg-adapter`**

Run: `npm install resend next-auth@beta @auth/pg-adapter@beta`
Expected: all three added to `dependencies` in `package.json`.

- [ ] **Step 4: Write the email-sending implementation**

```typescript
// src/lib/email/sendMagicLink.ts
import { Resend } from 'resend';

export async function sendMagicLink({ to, url }: { to: string; url: string }): Promise<void> {
  const resend = new Resend(process.env.RESEND_API_KEY);
  const from = process.env.EMAIL_FROM ?? 'PromoPost <login@promopost.tobiestore.com.br>';

  const { error } = await resend.emails.send({
    from,
    to,
    subject: 'Seu link de acesso ao PromoPost',
    html: `<p>Clique para entrar no PromoPost:</p><p><a href="${url}">${url}</a></p>`,
  });

  if (error) {
    throw new Error(`Falha ao enviar email de login: ${error.message}`);
  }
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run src/lib/email/sendMagicLink.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 6: Write the Auth.js config**

Create `src/auth.ts`:

```typescript
import NextAuth from 'next-auth';
import Nodemailer from 'next-auth/providers/nodemailer';
import PostgresAdapter from '@auth/pg-adapter';
import { getPool } from '@/lib/db/pool';
import { sendMagicLink } from '@/lib/email/sendMagicLink';

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: PostgresAdapter(getPool()),
  session: { strategy: 'database' },
  providers: [
    Nodemailer({
      server: '',
      from: process.env.EMAIL_FROM ?? 'PromoPost <login@promopost.tobiestore.com.br>',
      async sendVerificationRequest({ identifier, url }) {
        await sendMagicLink({ to: identifier, url });
      },
    }),
  ],
});
```

**Note for the implementer:** `next-auth@beta` and `@auth/pg-adapter@beta` are both pre-1.0 and their exact type signatures can shift between beta releases. If `npm run typecheck` (next step) reports a type mismatch against this exact code (e.g. `Nodemailer`'s `server` field, or the adapter's constructor signature), check the installed version's own `.d.ts` under `node_modules/next-auth` / `node_modules/@auth/pg-adapter` and adjust — the shape (Postgres adapter + a Nodemailer-style provider with a custom `sendVerificationRequest` that ignores real SMTP) is the part that must stay the same, not the exact literal syntax.

- [ ] **Step 7: Write the route handler**

Create `src/app/api/auth/[...nextauth]/route.ts`:

```typescript
export { GET, POST } from '@/auth';
```

- [ ] **Step 8: Add `AUTH_SECRET` and run typecheck**

1. In `.env` (local dev), set `AUTH_SECRET` to the output of `openssl rand -hex 32`.
2. Run: `npm run typecheck`
   Expected: no errors. If there are type errors from `next-auth`/`@auth/pg-adapter`, resolve per the note in Step 6 before proceeding.

- [ ] **Step 9: Commit**

```bash
git add src/auth.ts src/app/api/auth src/lib/email/sendMagicLink.ts src/lib/email/sendMagicLink.test.ts package.json package-lock.json
git commit -m "feat: configura Auth.js com Postgres adapter e magic link via Resend"
```

---

### Task 4: Login, onboarding, and dashboard pages

**Files:**
- Create: `src/app/login/page.tsx`
- Create: `src/app/(app)/layout.tsx`
- Create: `src/app/(app)/onboarding/page.tsx`
- Create: `src/app/(app)/dashboard/page.tsx`

**Interfaces:**
- Consumes: `auth`, `signIn` from `src/auth.ts` (Task 3); `getPool` from `src/lib/db/pool.ts` (Task 1); `getBusinessForUser`, `createBusinessForUser` from `src/lib/db/businesses.ts` (Task 2).
- Produces: the three routes (`/login`, `/onboarding`, `/dashboard`). Nothing downstream in this plan depends on these — terminal task. A future plan (Peça 2, TikTok connection) will extend `/dashboard`.

No automated test for this task — same reasoning as Task 2 of `docs/superpowers/plans/2026-08-27-tiktok-admin-demo.md` (no precedent in this codebase for testing Next.js pages, and this task is a thin composition of already-tested pieces). Verify manually per Step 5.

- [ ] **Step 1: Write the login page**

Create `src/app/login/page.tsx`:

```typescript
import { signIn } from '@/auth';

export default function LoginPage() {
  async function login(formData: FormData) {
    'use server';
    const email = formData.get('email');
    if (typeof email !== 'string' || !email.trim()) return;
    await signIn('nodemailer', { email, redirectTo: '/dashboard' });
  }

  return (
    <main style={{ maxWidth: 400, margin: '0 auto', padding: '48px 24px', lineHeight: 1.6 }}>
      <h1>Entrar no PromoPost</h1>
      <form action={login} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <input
          type="email"
          name="email"
          placeholder="seu@email.com"
          required
          style={{ padding: 8, boxSizing: 'border-box' }}
        />
        <button type="submit" style={{ padding: 12 }}>
          Enviar link de acesso
        </button>
      </form>
    </main>
  );
}
```

- [ ] **Step 2: Write the authenticated-area layout**

Create `src/app/(app)/layout.tsx`:

```typescript
import { redirect } from 'next/navigation';
import { auth } from '@/auth';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user) {
    redirect('/login');
  }
  return <>{children}</>;
}
```

- [ ] **Step 3: Write the onboarding page**

Create `src/app/(app)/onboarding/page.tsx`:

```typescript
import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { getPool } from '@/lib/db/pool';
import { createBusinessForUser } from '@/lib/db/businesses';

export default async function OnboardingPage() {
  async function createBusiness(formData: FormData) {
    'use server';
    const name = formData.get('name');
    if (typeof name !== 'string' || !name.trim()) return;

    const session = await auth();
    if (!session?.user?.id) return;

    await createBusinessForUser(getPool(), session.user.id, name.trim());
    redirect('/dashboard');
  }

  return (
    <main style={{ maxWidth: 400, margin: '0 auto', padding: '48px 24px', lineHeight: 1.6 }}>
      <h1>Qual o nome da sua empresa?</h1>
      <form action={createBusiness} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <input
          type="text"
          name="name"
          placeholder="Nome da empresa"
          required
          style={{ padding: 8, boxSizing: 'border-box' }}
        />
        <button type="submit" style={{ padding: 12 }}>
          Continuar
        </button>
      </form>
    </main>
  );
}
```

- [ ] **Step 4: Write the dashboard page**

Create `src/app/(app)/dashboard/page.tsx`:

```typescript
import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { getPool } from '@/lib/db/pool';
import { getBusinessForUser } from '@/lib/db/businesses';

export default async function DashboardPage() {
  const session = await auth();
  if (!session?.user?.id) {
    redirect('/login');
  }

  const business = await getBusinessForUser(getPool(), session.user.id);
  if (!business) {
    redirect('/onboarding');
  }

  return (
    <main style={{ maxWidth: 640, margin: '0 auto', padding: '48px 24px', lineHeight: 1.6 }}>
      <h1>Bem-vindo, {business.name}</h1>
      <p>Em breve: conectar sua conta do TikTok.</p>
      <button disabled style={{ padding: 12, opacity: 0.5 }}>
        Conectar TikTok (em breve)
      </button>
    </main>
  );
}
```

- [ ] **Step 5: Manually verify the full flow in the browser**

1. Confirm `db` is up (`docker compose ps`) and `.env` has `AUTH_SECRET`, `DATABASE_URL`, `RESEND_API_KEY`, `EMAIL_FROM` set (Tasks 1 and 3).
2. Run: `npm run dev`
3. Open `http://localhost:3000/dashboard` (not logged in) → confirm it redirects to `/login`.
4. On `/login`, enter a real email you can check → submit.
5. Check that inbox for the magic-link email (subject "Seu link de acesso ao PromoPost") → click the link.
6. Confirm you land on `/onboarding` (first login, no business yet) → fill in a business name → submit.
7. Confirm you land on `/dashboard` showing "Bem-vindo, `<nome que você digitou>`".
8. Reload `/dashboard` → confirm it still shows the same welcome message (session persists, business lookup works) instead of bouncing back to onboarding.
9. Run: `npm run typecheck` → expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add "src/app/login" "src/app/(app)"
git commit -m "feat: adiciona paginas de login, onboarding e dashboard"
```
