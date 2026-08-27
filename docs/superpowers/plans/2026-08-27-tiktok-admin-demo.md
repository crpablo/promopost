# TikTok Admin Demo Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a token-gated `/admin` page that manually triggers a real TikTok post, so there's a recordable user journey for TikTok's Production app-review demo video.

**Architecture:** A new POST route (`/api/admin/tiktok-post`) validates a shared-secret token and calls the existing `postToTikTok()` (unchanged) after wrapping the image URL through the existing own-domain image proxy pattern. A new Next.js App Router page (`/admin`) gates on the same token via query string and renders a client-side form that calls the route.

**Tech Stack:** Next.js App Router (route handlers + server/client components), Vitest for route tests, existing `src/lib/social/tiktok.ts`.

## Global Constraints

- Token validation happens **server-side in the route handler**, not only in the page — mirrors the existing `WEBHOOK_SECRET` check in `src/app/api/webhook/route.ts:280-283`.
- `postToTikTok()` in `src/lib/social/tiktok.ts` is reused unmodified.
- Image URL must be wrapped through `${WEBHOOK_BASE_URL}/api/tiktok-image-proxy?imageUrl=...` before being passed to `postToTikTok()` — same pattern as `buildTikTokImageProxyUrl()` in `src/app/api/webhook/route.ts:61-68` (TikTok only accepts `pull_by_url` from our own verified domain).
- No login/session system — single shared token compared by string equality, same security level as the webhook.
- Inline styles only, no CSS framework — matches every existing page (`src/app/politica-de-privacidade/page.tsx`, `src/app/termos-de-uso/page.tsx`, `src/app/page.tsx`).

---

### Task 1: `POST /api/admin/tiktok-post` route

**Files:**
- Create: `src/app/api/admin/tiktok-post/route.ts`
- Test: `src/app/api/admin/tiktok-post/route.test.ts`

**Interfaces:**
- Consumes: `postToTikTok(imageUrl: string, title: string, description: string): Promise<{ postId: string }>` from `@/lib/social/tiktok` (existing, unchanged).
- Produces: `POST` handler at `/api/admin/tiktok-post`. Request body: `{ token: string, imageUrl: string, title: string, description: string }`. Response: `{ ok: true, postId: string }` (200) or `{ ok: false, error: string }` (401/400/500/502). Task 2 (the form) calls this exact shape.

- [ ] **Step 1: Write the failing tests**

```typescript
// src/app/api/admin/tiktok-post/route.test.ts
import { afterEach, describe, expect, it, vi } from 'vitest';

const { postToTikTokMock } = vi.hoisted(() => ({ postToTikTokMock: vi.fn() }));

vi.mock('@/lib/social/tiktok', () => ({ postToTikTok: postToTikTokMock }));

import { POST } from './route';

function makeRequest(body: unknown) {
  return new Request('https://promopost.example.com/api/admin/tiktok-post', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const VALID_BODY = {
  token: 'correct-token',
  imageUrl: 'https://http2.mlstatic.com/D_1.jpg',
  title: 'Produto teste',
  description: 'Descrição teste',
};

describe('POST /api/admin/tiktok-post', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it('retorna 401 quando o token está errado', async () => {
    vi.stubEnv('ADMIN_TOKEN', 'correct-token');
    const response = await POST(makeRequest({ ...VALID_BODY, token: 'wrong-token' }));
    expect(response.status).toBe(401);
    expect(postToTikTokMock).not.toHaveBeenCalled();
  });

  it('retorna 401 quando ADMIN_TOKEN não está configurado no ambiente', async () => {
    const response = await POST(makeRequest(VALID_BODY));
    expect(response.status).toBe(401);
  });

  it('retorna 400 quando falta um campo obrigatório', async () => {
    vi.stubEnv('ADMIN_TOKEN', 'correct-token');
    const bodyWithoutImageUrl = { token: 'correct-token', title: 'Produto teste', description: 'Descrição teste' };
    const response = await POST(makeRequest(bodyWithoutImageUrl));
    expect(response.status).toBe(400);
    expect(postToTikTokMock).not.toHaveBeenCalled();
  });

  it('retorna 500 quando WEBHOOK_BASE_URL não está configurado', async () => {
    vi.stubEnv('ADMIN_TOKEN', 'correct-token');
    const response = await POST(makeRequest(VALID_BODY));
    expect(response.status).toBe(500);
    expect(postToTikTokMock).not.toHaveBeenCalled();
  });

  it('monta a URL proxied e chama postToTikTok, retornando o postId em caso de sucesso', async () => {
    vi.stubEnv('ADMIN_TOKEN', 'correct-token');
    vi.stubEnv('WEBHOOK_BASE_URL', 'https://promopost.tobiestore.com.br');
    postToTikTokMock.mockResolvedValue({ postId: 'abc123' });

    const response = await POST(makeRequest(VALID_BODY));
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json).toEqual({ ok: true, postId: 'abc123' });
    expect(postToTikTokMock).toHaveBeenCalledWith(
      'https://promopost.tobiestore.com.br/api/tiktok-image-proxy?imageUrl=' +
        encodeURIComponent('https://http2.mlstatic.com/D_1.jpg'),
      'Produto teste',
      'Descrição teste',
    );
  });

  it('retorna 502 com a mensagem de erro quando postToTikTok falha', async () => {
    vi.stubEnv('ADMIN_TOKEN', 'correct-token');
    vi.stubEnv('WEBHOOK_BASE_URL', 'https://promopost.tobiestore.com.br');
    postToTikTokMock.mockRejectedValue(new Error('picture_size_check_failed'));

    const response = await POST(makeRequest(VALID_BODY));
    const json = await response.json();

    expect(response.status).toBe(502);
    expect(json).toEqual({ ok: false, error: 'picture_size_check_failed' });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/app/api/admin/tiktok-post/route.test.ts`
Expected: FAIL — `Cannot find module './route'` (file doesn't exist yet).

- [ ] **Step 3: Write the route implementation**

```typescript
// src/app/api/admin/tiktok-post/route.ts
import { postToTikTok } from '@/lib/social/tiktok';

function toErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export async function POST(request: Request): Promise<Response> {
  let body: { token?: string; imageUrl?: string; title?: string; description?: string };
  try {
    body = await request.json();
  } catch {
    return Response.json({ ok: false, error: 'JSON inválido' }, { status: 400 });
  }

  if (!body.token || body.token !== process.env.ADMIN_TOKEN) {
    return Response.json({ ok: false, error: 'não autorizado' }, { status: 401 });
  }

  const { imageUrl, title, description } = body;
  if (!imageUrl || !title || !description) {
    return Response.json(
      { ok: false, error: 'Campos obrigatórios: imageUrl, title, description' },
      { status: 400 },
    );
  }

  const baseUrl = process.env.WEBHOOK_BASE_URL;
  if (!baseUrl) {
    return Response.json({ ok: false, error: 'WEBHOOK_BASE_URL não configurado' }, { status: 500 });
  }
  const proxiedImageUrl = `${baseUrl}/api/tiktok-image-proxy?${new URLSearchParams({ imageUrl }).toString()}`;

  try {
    const result = await postToTikTok(proxiedImageUrl, title, description);
    return Response.json({ ok: true, postId: result.postId });
  } catch (err) {
    return Response.json({ ok: false, error: toErrorMessage(err) }, { status: 502 });
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/app/api/admin/tiktok-post/route.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add src/app/api/admin/tiktok-post/route.ts src/app/api/admin/tiktok-post/route.test.ts
git commit -m "feat: adiciona rota admin para postar no TikTok manualmente"
```

---

### Task 2: `/admin` page with token gate and form

**Files:**
- Create: `src/app/admin/page.tsx`
- Create: `src/app/admin/TikTokPostForm.tsx`

**Interfaces:**
- Consumes: `POST /api/admin/tiktok-post` from Task 1 — body `{ token, imageUrl, title, description }`, response `{ ok: true, postId: string } | { ok: false, error: string }`.
- Produces: page at `/admin?token=<ADMIN_TOKEN>`. Nothing downstream depends on this (terminal task).

No automated test for this task — the codebase has no precedent for testing App Router page/client components (only `route.ts` handlers and `src/lib` modules have `.test.ts` files). Verify manually per Step 4 below, per the project convention of browser-testing UI changes before calling them done.

- [ ] **Step 1: Write the client form component**

```typescript
// src/app/admin/TikTokPostForm.tsx
'use client';

import { useState, type FormEvent } from 'react';

const EXEMPLO_IMAGEM =
  'https://http2.mlstatic.com/D_NQ_NP_2X_856819-MLA45678901234_012026-F.webp';

type Resultado = { ok: true; postId: string } | { ok: false; error: string };

export default function TikTokPostForm({ token }: { token: string }) {
  const [imageUrl, setImageUrl] = useState(EXEMPLO_IMAGEM);
  const [title, setTitle] = useState('Produto em promoção');
  const [description, setDescription] = useState('Confira essa oferta na Tobie Store!');
  const [enviando, setEnviando] = useState(false);
  const [resultado, setResultado] = useState<Resultado | null>(null);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setEnviando(true);
    setResultado(null);
    try {
      const response = await fetch('/api/admin/tiktok-post', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token, imageUrl, title, description }),
      });
      const json = (await response.json()) as Resultado;
      setResultado(json);
    } catch (err) {
      setResultado({ ok: false, error: err instanceof Error ? err.message : String(err) });
    } finally {
      setEnviando(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <label>
        URL da imagem
        <input
          type="text"
          value={imageUrl}
          onChange={(e) => setImageUrl(e.target.value)}
          style={{ width: '100%', padding: 8, boxSizing: 'border-box' }}
        />
      </label>
      <label>
        Título
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          style={{ width: '100%', padding: 8, boxSizing: 'border-box' }}
        />
      </label>
      <label>
        Descrição
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={3}
          style={{ width: '100%', padding: 8, boxSizing: 'border-box' }}
        />
      </label>
      <button type="submit" disabled={enviando} style={{ padding: 12 }}>
        {enviando ? 'Publicando...' : 'Publicar no TikTok'}
      </button>
      {resultado && (
        <p style={{ color: resultado.ok ? 'green' : 'crimson' }}>
          {resultado.ok ? `Publicado! postId: ${resultado.postId}` : `Erro: ${resultado.error}`}
        </p>
      )}
    </form>
  );
}
```

- [ ] **Step 2: Write the page with the token gate**

```typescript
// src/app/admin/page.tsx
import TikTokPostForm from './TikTokPostForm';

export default async function AdminPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;

  if (!token || token !== process.env.ADMIN_TOKEN) {
    return (
      <main style={{ maxWidth: 640, margin: '0 auto', padding: '48px 24px' }}>
        <h1>404</h1>
        <p>Página não encontrada.</p>
      </main>
    );
  }

  return (
    <main style={{ maxWidth: 640, margin: '0 auto', padding: '48px 24px', lineHeight: 1.6 }}>
      <h1>Postar no TikTok (teste manual)</h1>
      <TikTokPostForm token={token} />
    </main>
  );
}
```

- [ ] **Step 3: Run typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 4: Manually verify in the browser**

1. In `.env.local`, set `ADMIN_TOKEN=teste-local` (and confirm `WEBHOOK_BASE_URL` and the TikTok Sandbox vars from `docs/runbook.md` section 11 are already set, since this hits the real TikTok API).
2. Run: `npm run dev`
3. Open `http://localhost:3000/admin` (no token) → confirm it shows the generic "404" content.
4. Open `http://localhost:3000/admin?token=wrong` → confirm same "404" content.
5. Open `http://localhost:3000/admin?token=teste-local` → confirm the form renders with the pre-filled example values.
6. Click "Publicar no TikTok" → confirm either a success message with a `postId`, or a real error message from the TikTok API (both are acceptable outcomes for this check — the point is the request round-trips end to end, not that the specific demo image succeeds).

- [ ] **Step 5: Commit**

```bash
git add src/app/admin/page.tsx src/app/admin/TikTokPostForm.tsx
git commit -m "feat: adiciona pagina admin para disparar post de teste no TikTok"
```

---

### Task 3: Document `ADMIN_TOKEN` in `.env.example` and the runbook

**Files:**
- Modify: `.env.example:7` (near `WEBHOOK_SECRET=`)
- Modify: `docs/runbook.md` (new subsection after existing section 11.5, before `## 12. Shopee`)

**Interfaces:** None — documentation only, no code depends on this task.

- [ ] **Step 1: Add `ADMIN_TOKEN` to `.env.example`**

Add this line directly below the existing `WEBHOOK_SECRET=` line (line 7):

```
ADMIN_TOKEN=
```

- [ ] **Step 2: Add a runbook subsection**

Insert this new subsection into `docs/runbook.md`, immediately after the existing `### 11.5 Se algo falhar` block (right before the `## 12. Shopee` heading):

```markdown
### 11.6 Página admin para post manual (gravação de vídeo de review)

O PromoPost não tem UI de usuário — toda postagem é disparada por webhook. Para gravar o vídeo demo exigido pela revisão de Produção da TikTok (mostrando o fluxo de Login Kit + Content Posting API), existe uma página interna em `/admin` que dispara `postToTikTok()` manualmente, sem esperar um webhook real.

1. Configure `ADMIN_TOKEN` (uma string qualquer, só sua) nas variáveis de ambiente.
2. Acesse `https://promopost.tobiestore.com.br/admin?token=<ADMIN_TOKEN>`. Sem o token certo na query string, a página mostra um "404" genérico — não revela que a ferramenta existe.
3. O formulário já vem preenchido com um exemplo de URL de imagem, título e descrição — edite se quiser, e clique em "Publicar no TikTok".
4. A página mostra o `postId` em caso de sucesso, ou a mensagem de erro crua da TikTok em caso de falha (mesma tabela de causas da seção 11.5 se aplica).

Essa rota reaproveita o mesmo `postToTikTok()` e o mesmo proxy de imagem (`/api/tiktok-image-proxy`) do fluxo de produção — o que ela pula é só a origem do disparo (formulário em vez de webhook do Mercado Livre).
```

- [ ] **Step 3: Commit**

```bash
git add .env.example docs/runbook.md
git commit -m "docs: documenta ADMIN_TOKEN e a pagina admin do TikTok no runbook"
```
