# Publicação Manual no TikTok por Tenant Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deixar qualquer empresa com TikTok conectado publicar uma foto de verdade através da própria interface do produto (`/dashboard`), fechando o gap que a demonstração de resubmissão à TikTok exige (Login Kit + Content Posting API pela interface real, não pelo `/admin` interno).

**Architecture:** Refatora `postToTikTok` (`src/lib/social/tiktok.ts`) pra receber o access token como parâmetro em vez de carregar sozinho do arquivo interno — os três chamadores existentes (`webhook/route.ts` ×2, `admin/tiktok-post/route.ts` ×1) passam a obter o token deles mesmos via `getValidAccessToken()`, agora exportada. Um módulo novo (`tiktokTenantAuth.ts`) espelha essa mesma lógica de validade/renovação, mas lendo de `tiktok_accounts` em vez do arquivo. Uma rota nova (`/api/tiktok/post`) e um formulário novo no `/dashboard` compõem essas peças pro fluxo do tenant.

**Tech Stack:** Next.js App Router (existente), Postgres (existente), Vitest.

## Global Constraints

- `postToTikTok(accessToken: string, imageUrl: string, title: string, description: string): Promise<SocialPostResult>` — accessToken é o novo primeiro parâmetro. Comportamento interno (creator_info, init, polling) não muda.
- `getValidAccessToken(): Promise<string>` (em `src/lib/social/tiktok.ts`) passa a ser exportada — sem mudança de lógica interna.
- Nenhum dos três chamadores existentes de `postToTikTok` muda de comportamento observável — só passam a obter o token explicitamente antes de chamar.
- Conta TikTok do tenant precisa estar como "Conta privada" pra postar (restrição de apps não auditados, já documentada na Peça 2) — o formulário deve deixar isso explícito.
- Sem upload de arquivo — o campo de imagem é uma URL colada, com preview ao vivo.
- Sem botão de desconectar TikTok (decisão já tomada na Peça 2, não muda aqui).
- Interface com "cara de produto", não de admin: mesmos inline styles já usados em `/login`/`/onboarding`/`/dashboard`, labels acima dos campos, sem token na URL.
- Reaproveita `WEBHOOK_BASE_URL` (já configurado) pra montar a URL do proxy de imagem — mesmo padrão de `admin/tiktok-post/route.ts` e `webhook/route.ts`, sem env var nova.

---

### Task 1: Refatora `postToTikTok` pra receber o token como parâmetro

**Files:**
- Modify: `src/lib/social/tiktok.ts`
- Modify: `src/lib/social/tiktok.test.ts`
- Modify: `src/app/api/webhook/route.ts`
- Modify: `src/app/api/webhook/route.test.ts`
- Modify: `src/app/api/admin/tiktok-post/route.ts`
- Modify: `src/app/api/admin/tiktok-post/route.test.ts`

**Interfaces:**
- Produces: `postToTikTok(accessToken: string, imageUrl: string, title: string, description: string): Promise<SocialPostResult>` e `getValidAccessToken(): Promise<string>`, ambas exportadas de `src/lib/social/tiktok.ts`. Task 2 (`tiktokTenantAuth.ts`) e Task 3 (rota `/api/tiktok/post`) importam `postToTikTok` com essa assinatura nova.

Este é um refactor — os três chamadores de `postToTikTok` e o arquivo de teste da própria função mudam juntos, senão o build/testes quebram no meio do caminho. Segue TDD adaptado: reescreve os testes pro formato novo primeiro, confirma que falham contra o código atual, só depois aplica a mudança na implementação.

- [ ] **Step 1: Reescrever `src/lib/social/tiktok.test.ts` pro formato novo**

Substituir o conteúdo inteiro do arquivo por:

```typescript
import { afterEach, describe, expect, it, vi } from 'vitest';

const { loadTikTokTokensMock, saveTikTokTokensMock } = vi.hoisted(() => ({
  loadTikTokTokensMock: vi.fn(),
  saveTikTokTokensMock: vi.fn(),
}));

// Mock parcial: mantém exchangeTikTokToken real (usa o fetch stub de cada
// teste) e só substitui load/save, que é o que os testes precisam controlar.
vi.mock('./tiktokTokenStore', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./tiktokTokenStore')>();
  return {
    ...actual,
    loadTikTokTokens: loadTikTokTokensMock,
    saveTikTokTokens: saveTikTokTokensMock,
  };
});

import { getValidAccessToken, postToTikTok } from './tiktok';

function stubEnv() {
  vi.stubEnv('TIKTOK_CLIENT_KEY', 'fake-client-key');
  vi.stubEnv('TIKTOK_CLIENT_SECRET', 'fake-client-secret');
}

const VALID_TOKENS = {
  accessToken: 'valid-access-token',
  refreshToken: 'valid-refresh-token',
  expiresAt: Date.now() + 60 * 60 * 1000, // expira em 1h — não precisa renovar
};

function creatorInfoResponse(privacyLevelOptions: string[], commentDisabled = false) {
  return {
    ok: true,
    json: async () => ({
      data: { privacy_level_options: privacyLevelOptions, comment_disabled: commentDisabled },
      error: { code: 'ok' },
    }),
  };
}

describe('getValidAccessToken', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it('retorna o token salvo, sem renovar, quando ele ainda não está perto de expirar', async () => {
    stubEnv();
    loadTikTokTokensMock.mockResolvedValue(VALID_TOKENS);

    const token = await getValidAccessToken();

    expect(token).toBe('valid-access-token');
    expect(saveTikTokTokensMock).not.toHaveBeenCalled();
  });

  it('renova o token quando ele está perto de expirar', async () => {
    stubEnv();
    loadTikTokTokensMock.mockResolvedValue({
      accessToken: 'old-access-token',
      refreshToken: 'old-refresh-token',
      expiresAt: Date.now() + 60 * 1000, // expira em 1min — precisa renovar
    });
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          access_token: 'new-access-token',
          refresh_token: 'new-refresh-token',
          expires_in: 86400,
        }),
      }),
    );

    const token = await getValidAccessToken();

    expect(token).toBe('new-access-token');
    expect(saveTikTokTokensMock).toHaveBeenCalledWith(
      expect.objectContaining({ accessToken: 'new-access-token', refreshToken: 'new-refresh-token' }),
    );
  });

  it('lança erro quando a renovação do token falha', async () => {
    stubEnv();
    loadTikTokTokensMock.mockResolvedValue({
      accessToken: 'old-access-token',
      refreshToken: 'expired-refresh-token',
      expiresAt: Date.now() - 1000, // já expirado
    });
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        json: async () => ({ error: 'invalid_grant', error_description: 'Refresh token expirado' }),
      }),
    );

    await expect(getValidAccessToken()).rejects.toThrow('Falha ao renovar token do TikTok');
  });

  it('lança erro quando não existe token salvo (nunca rodou o bootstrap)', async () => {
    stubEnv();
    loadTikTokTokensMock.mockResolvedValue(null);

    await expect(getValidAccessToken()).rejects.toThrow('Token do TikTok não configurado');
  });

  it('lança erro quando faltam variáveis de ambiente', async () => {
    loadTikTokTokensMock.mockResolvedValue({
      accessToken: 'x',
      refreshToken: 'y',
      expiresAt: Date.now() - 1000, // força o caminho de renovação, que precisa das env vars
    });

    await expect(getValidAccessToken()).rejects.toThrow('Variáveis de ambiente do TikTok ausentes');
  });

  it('lança erro e não salva quando a renovação retorna 200 sem refresh_token (evita corromper o token store)', async () => {
    stubEnv();
    loadTikTokTokensMock.mockResolvedValue({
      accessToken: 'old-access-token',
      refreshToken: 'old-refresh-token',
      expiresAt: Date.now() + 60 * 1000, // perto de expirar — força renovação
    });
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ access_token: 'new-access-token', expires_in: 86400 }), // sem refresh_token
      }),
    );

    await expect(getValidAccessToken()).rejects.toThrow('Falha ao renovar token do TikTok');
    expect(saveTikTokTokensMock).not.toHaveBeenCalled();
  });
});

describe('postToTikTok', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it('posta com o token recebido', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(creatorInfoResponse(['PUBLIC_TO_EVERYONE', 'SELF_ONLY']))
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: { publish_id: 'pub_1' }, error: { code: 'ok' } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: { status: 'PUBLISH_COMPLETE' }, error: { code: 'ok' } }),
      });
    vi.stubGlobal('fetch', fetchMock);

    const result = await postToTikTok('valid-access-token', 'https://x.com/img.jpg', 'Produto X', 'legenda completa');

    expect(result).toEqual({ postId: 'pub_1' });

    const [creatorInfoUrl, creatorInfoOptions] = fetchMock.mock.calls[0];
    expect(creatorInfoUrl).toBe('https://open.tiktokapis.com/v2/post/publish/creator_info/query/');
    expect(creatorInfoOptions.headers.Authorization).toBe('Bearer valid-access-token');

    const [initUrl, initOptions] = fetchMock.mock.calls[1];
    expect(initUrl).toBe('https://open.tiktokapis.com/v2/post/publish/content/init/');
    expect(initOptions.headers.Authorization).toBe('Bearer valid-access-token');
    expect(JSON.parse(initOptions.body)).toEqual({
      media_type: 'PHOTO',
      post_mode: 'DIRECT_POST',
      post_info: {
        title: 'Produto X',
        description: 'legenda completa',
        privacy_level: 'SELF_ONLY',
        disable_comment: false,
        auto_add_music: false,
        brand_content_toggle: false,
        brand_organic_toggle: false,
      },
      source_info: {
        source: 'PULL_FROM_URL',
        photo_images: ['https://x.com/img.jpg'],
        photo_cover_index: 0,
      },
    });

    const [statusUrl, statusOptions] = fetchMock.mock.calls[2];
    expect(statusUrl).toBe('https://open.tiktokapis.com/v2/post/publish/status/fetch/');
    expect(JSON.parse(statusOptions.body)).toEqual({ publish_id: 'pub_1' });
  });

  it('repassa disable_comment = true quando o creator_info reporta comment_disabled', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(creatorInfoResponse(['SELF_ONLY'], true))
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: { publish_id: 'pub_1' }, error: { code: 'ok' } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: { status: 'PUBLISH_COMPLETE' }, error: { code: 'ok' } }),
      });
    vi.stubGlobal('fetch', fetchMock);

    await postToTikTok('valid-access-token', 'https://x.com/img.jpg', 'Produto X', 'legenda completa');

    const [, initOptions] = fetchMock.mock.calls[1];
    expect(JSON.parse(initOptions.body).post_info.disable_comment).toBe(true);
  });

  it('lança erro quando a consulta de informações do criador falha', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        json: async () => ({ error: { code: 'access_token_invalid', message: 'Token inválido' } }),
      }),
    );

    await expect(
      postToTikTok('valid-access-token', 'https://x.com/img.jpg', 'Produto X', 'legenda'),
    ).rejects.toThrow('Falha ao consultar informações do criador no TikTok: Token inválido');
  });

  it('lança erro quando SELF_ONLY não está entre as opções de privacidade do criador', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(creatorInfoResponse(['PUBLIC_TO_EVERYONE'])));

    await expect(
      postToTikTok('valid-access-token', 'https://x.com/img.jpg', 'Produto X', 'legenda'),
    ).rejects.toThrow('SELF_ONLY não disponível');
  });

  it('lança erro quando a criação da publicação falha', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(creatorInfoResponse(['SELF_ONLY']))
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ error: { code: 'invalid_params', message: 'Imagem inválida' } }),
      });
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      postToTikTok('valid-access-token', 'https://x.com/img.jpg', 'Produto X', 'legenda'),
    ).rejects.toThrow('Falha ao publicar no TikTok: Imagem inválida (code: invalid_params)');
  });

  it('lança erro quando o status da publicação vem como FAILED', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(creatorInfoResponse(['SELF_ONLY']))
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: { publish_id: 'pub_1' }, error: { code: 'ok' } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: { status: 'FAILED', fail_reason: 'picture_size_check_failed' },
          error: { code: 'ok' },
        }),
      });
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      postToTikTok('valid-access-token', 'https://x.com/img.jpg', 'Produto X', 'legenda'),
    ).rejects.toThrow('Falha ao publicar no TikTok: picture_size_check_failed');
  });

  it('lança erro em português quando o polling de status responde sem o campo data', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(creatorInfoResponse(['SELF_ONLY']))
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: { publish_id: 'pub_1' }, error: { code: 'ok' } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ error: { code: 'ok' } }), // sem data
      });
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      postToTikTok('valid-access-token', 'https://x.com/img.jpg', 'Produto X', 'legenda'),
    ).rejects.toThrow('Resposta inesperada da TikTok ao checar status da publicação');
  });
});
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

Run: `npx vitest run src/lib/social/tiktok.test.ts`
Expected: FAIL — `getValidAccessToken` não é exportada de `./tiktok` ainda, e as chamadas de `postToTikTok` com 4 argumentos não batem com a assinatura atual (3 argumentos).

- [ ] **Step 3: Atualizar `src/lib/social/tiktok.ts`**

Duas mudanças pontuais no arquivo existente:

1. Adicionar `export` antes da declaração de `getValidAccessToken`:

```typescript
// Antes:
async function getValidAccessToken(): Promise<string> {
// Depois:
export async function getValidAccessToken(): Promise<string> {
```

2. Mudar a assinatura de `postToTikTok` pra receber o token como parâmetro, removendo a chamada interna a `getValidAccessToken()`:

```typescript
// Antes:
export async function postToTikTok(
  imageUrl: string,
  title: string,
  description: string,
): Promise<SocialPostResult> {
  const accessToken = await getValidAccessToken();

  const creatorInfo = await queryCreatorInfo(accessToken);
// Depois:
export async function postToTikTok(
  accessToken: string,
  imageUrl: string,
  title: string,
  description: string,
): Promise<SocialPostResult> {
  const creatorInfo = await queryCreatorInfo(accessToken);
```

Nada mais no arquivo muda — `refreshAccessToken`, `queryCreatorInfo`, `waitForPublishComplete` e as constantes continuam exatamente como estão.

- [ ] **Step 4: Rodar o teste e confirmar que passa**

Run: `npx vitest run src/lib/social/tiktok.test.ts`
Expected: PASS (12 testes: 6 em `getValidAccessToken`, 6 em `postToTikTok`)

- [ ] **Step 5: Atualizar `src/app/api/webhook/route.ts`**

1. Trocar o import (linha 13):

```typescript
// Antes:
import { postToTikTok } from '@/lib/social/tiktok';
// Depois:
import { getValidAccessToken, postToTikTok } from '@/lib/social/tiktok';
```

2. No primeiro `tiktokPromise` (dentro de `postToSocialNetworks`, o bloco que usa `buildTikTokImageProxyUrl(product)`):

```typescript
// Antes:
    try {
      const proxiedImageUrl = buildTikTokImageProxyUrl(product);
      const title = product.title.slice(0, 90);
      const r = await postToTikTok(proxiedImageUrl, title, caption as string);
      return { ok: true, postId: r.postId };
// Depois:
    try {
      const accessToken = await getValidAccessToken();
      const proxiedImageUrl = buildTikTokImageProxyUrl(product);
      const title = product.title.slice(0, 90);
      const r = await postToTikTok(accessToken, proxiedImageUrl, title, caption as string);
      return { ok: true, postId: r.postId };
```

3. No segundo `tiktokPromise` (dentro de `postCouponToSocialNetworks`, o bloco que usa `couponImageUrl`):

```typescript
// Antes:
    try {
      const r = await postToTikTok(couponImageUrl, articleTitle.slice(0, 90), caption);
      return { ok: true, postId: r.postId };
// Depois:
    try {
      const accessToken = await getValidAccessToken();
      const r = await postToTikTok(accessToken, couponImageUrl, articleTitle.slice(0, 90), caption);
      return { ok: true, postId: r.postId };
```

- [ ] **Step 6: Atualizar `src/app/api/webhook/route.test.ts`**

1. Trocar o mock factory (linha 10) e o import (linha 31):

```typescript
// Antes:
vi.mock('@/lib/social/tiktok', () => ({ postToTikTok: vi.fn() }));
// Depois:
vi.mock('@/lib/social/tiktok', () => ({
  postToTikTok: vi.fn(),
  getValidAccessToken: vi.fn().mockResolvedValue('fake-access-token'),
}));
```

(o import de `postToTikTok` já existente no arquivo não precisa mudar — o teste não referencia `getValidAccessToken` diretamente, só precisa que o mock acima resolva um valor válido por padrão)

2. Existem exatamente duas ocorrências do bloco abaixo no arquivo (confirmar com `grep -n "toHaveBeenCalledWith(" src/app/api/webhook/route.test.ts` antes de editar) — em ambas, adicionar `'fake-access-token',` como primeiro argumento:

```typescript
// Antes (as duas ocorrências, idênticas):
    expect(postToTikTok).toHaveBeenCalledWith(
      'https://promopost.example.com/api/tiktok-image-proxy?imageUrl=https%3A%2F%2Fx.com%2Fimg.jpg',
      'Produto X',
      'legenda social',
    );
// Depois:
    expect(postToTikTok).toHaveBeenCalledWith(
      'fake-access-token',
      'https://promopost.example.com/api/tiktok-image-proxy?imageUrl=https%3A%2F%2Fx.com%2Fimg.jpg',
      'Produto X',
      'legenda social',
    );
```

- [ ] **Step 7: Rodar os testes do webhook e confirmar que passam**

Run: `npx vitest run src/app/api/webhook/route.test.ts`
Expected: PASS (mesma contagem de testes de antes, nenhum a menos)

- [ ] **Step 8: Atualizar `src/app/api/admin/tiktok-post/route.ts`**

```typescript
// Antes:
import { postToTikTok } from '@/lib/social/tiktok';
// Depois:
import { getValidAccessToken, postToTikTok } from '@/lib/social/tiktok';
```

```typescript
// Antes:
  try {
    const result = await postToTikTok(proxiedImageUrl, title, description);
    return Response.json({ ok: true, postId: result.postId });
// Depois:
  try {
    const accessToken = await getValidAccessToken();
    const result = await postToTikTok(accessToken, proxiedImageUrl, title, description);
    return Response.json({ ok: true, postId: result.postId });
```

- [ ] **Step 9: Atualizar `src/app/api/admin/tiktok-post/route.test.ts`**

```typescript
// Antes:
vi.mock('@/lib/social/tiktok', () => ({ postToTikTok: postToTikTokMock }));
// Depois:
vi.mock('@/lib/social/tiktok', () => ({
  postToTikTok: postToTikTokMock,
  getValidAccessToken: vi.fn().mockResolvedValue('fake-access-token'),
}));
```

```typescript
// Antes:
    expect(postToTikTokMock).toHaveBeenCalledWith(
      'https://promopost.tobiestore.com.br/api/tiktok-image-proxy?imageUrl=' +
        encodeURIComponent('https://http2.mlstatic.com/D_1.jpg'),
      'Produto teste',
      'Descrição teste',
    );
// Depois:
    expect(postToTikTokMock).toHaveBeenCalledWith(
      'fake-access-token',
      'https://promopost.tobiestore.com.br/api/tiktok-image-proxy?imageUrl=' +
        encodeURIComponent('https://http2.mlstatic.com/D_1.jpg'),
      'Produto teste',
      'Descrição teste',
    );
```

- [ ] **Step 10: Rodar os testes da rota admin e confirmar que passam**

Run: `npx vitest run src/app/api/admin/tiktok-post/route.test.ts`
Expected: PASS (mesma contagem de testes de antes)

- [ ] **Step 11: Rodar a suíte completa e o typecheck**

Run: `npm run typecheck && npx vitest run`
Expected: sem erros de tipo; todos os testes passando (nenhuma regressão em nenhum outro arquivo)

- [ ] **Step 12: Commit**

```bash
git add src/lib/social/tiktok.ts src/lib/social/tiktok.test.ts src/app/api/webhook/route.ts src/app/api/webhook/route.test.ts src/app/api/admin/tiktok-post/route.ts src/app/api/admin/tiktok-post/route.test.ts
git commit -m "refactor: postToTikTok recebe o access token como parametro"
```

---

### Task 2: Renovação de token por tenant (`tiktokTenantAuth.ts`)

**Files:**
- Create: `src/lib/social/tiktokTenantAuth.ts`
- Test: `src/lib/social/tiktokTenantAuth.test.ts`

**Interfaces:**
- Consumes: `getTikTokAccountForBusiness`, `saveTikTokAccountForBusiness` de `@/lib/db/tiktokAccounts` (Peça 2, já existe); `exchangeTikTokToken` de `./tiktokTokenStore` (já existe); `Pool` de `pg`.
- Produces: `getValidAccessTokenForBusiness(pool: Pool, businessId: string): Promise<string>` — lança erro se não houver conta conectada, renova automaticamente se perto de expirar. Task 3 (rota `/api/tiktok/post`) chama essa função.

- [ ] **Step 1: Escrever os testes que devem falhar**

```typescript
// src/lib/social/tiktokTenantAuth.test.ts
import { afterEach, describe, expect, it, vi } from 'vitest';

const { getTikTokAccountForBusinessMock, saveTikTokAccountForBusinessMock } = vi.hoisted(() => ({
  getTikTokAccountForBusinessMock: vi.fn(),
  saveTikTokAccountForBusinessMock: vi.fn(),
}));

vi.mock('@/lib/db/tiktokAccounts', () => ({
  getTikTokAccountForBusiness: getTikTokAccountForBusinessMock,
  saveTikTokAccountForBusiness: saveTikTokAccountForBusinessMock,
}));

import { getValidAccessTokenForBusiness } from './tiktokTenantAuth';

function stubEnv() {
  vi.stubEnv('TIKTOK_CLIENT_KEY', 'fake-client-key');
  vi.stubEnv('TIKTOK_CLIENT_SECRET', 'fake-client-secret');
}

const POOL = {} as unknown as import('pg').Pool;

describe('getValidAccessTokenForBusiness', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it('lança erro quando a empresa não tem conta TikTok conectada', async () => {
    getTikTokAccountForBusinessMock.mockResolvedValue(null);

    await expect(getValidAccessTokenForBusiness(POOL, 'biz-1')).rejects.toThrow(
      'Conta do TikTok não conectada',
    );
  });

  it('retorna o token salvo, sem renovar, quando ele ainda não está perto de expirar', async () => {
    getTikTokAccountForBusinessMock.mockResolvedValue({
      businessId: 'biz-1',
      accessToken: 'valid-access-token',
      refreshToken: 'valid-refresh-token',
      expiresAt: new Date(Date.now() + 60 * 60 * 1000), // expira em 1h
      connectedAt: new Date(),
    });

    const token = await getValidAccessTokenForBusiness(POOL, 'biz-1');

    expect(token).toBe('valid-access-token');
    expect(saveTikTokAccountForBusinessMock).not.toHaveBeenCalled();
  });

  it('renova o token e persiste quando ele está perto de expirar', async () => {
    stubEnv();
    getTikTokAccountForBusinessMock.mockResolvedValue({
      businessId: 'biz-1',
      accessToken: 'old-access-token',
      refreshToken: 'old-refresh-token',
      expiresAt: new Date(Date.now() + 60 * 1000), // expira em 1min — precisa renovar
      connectedAt: new Date(),
    });
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          access_token: 'new-access-token',
          refresh_token: 'new-refresh-token',
          expires_in: 86400,
        }),
      }),
    );

    const token = await getValidAccessTokenForBusiness(POOL, 'biz-1');

    expect(token).toBe('new-access-token');
    expect(saveTikTokAccountForBusinessMock).toHaveBeenCalledWith(POOL, 'biz-1', {
      accessToken: 'new-access-token',
      refreshToken: 'new-refresh-token',
      expiresAt: expect.any(Date),
    });
  });

  it('lança erro quando a renovação falha (ex: refresh token revogado)', async () => {
    stubEnv();
    getTikTokAccountForBusinessMock.mockResolvedValue({
      businessId: 'biz-1',
      accessToken: 'old-access-token',
      refreshToken: 'revoked-refresh-token',
      expiresAt: new Date(Date.now() - 1000), // já expirado
      connectedAt: new Date(),
    });
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        json: async () => ({ error: 'invalid_grant', error_description: 'Refresh token revogado' }),
      }),
    );

    await expect(getValidAccessTokenForBusiness(POOL, 'biz-1')).rejects.toThrow(
      'Falha ao renovar token do TikTok',
    );
  });
});
```

- [ ] **Step 2: Rodar os testes e confirmar que falham**

Run: `npx vitest run src/lib/social/tiktokTenantAuth.test.ts`
Expected: FAIL — `Cannot find module './tiktokTenantAuth'`

- [ ] **Step 3: Escrever a implementação**

```typescript
// src/lib/social/tiktokTenantAuth.ts
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
```

Nota: `exchangeTikTokToken` já lança `Falha ao trocar token do TikTok: ...` internamente quando a resposta da TikTok é malformada ou vem erro — esse `catch` aqui envolve numa mensagem com o prefixo `Falha ao renovar token do TikTok:`, mesma convenção de `refreshAccessToken` em `tiktok.ts`.

- [ ] **Step 4: Rodar os testes e confirmar que passam**

Run: `npx vitest run src/lib/social/tiktokTenantAuth.test.ts`
Expected: PASS (4 testes)

- [ ] **Step 5: Rodar o typecheck**

Run: `npm run typecheck`
Expected: sem erros

- [ ] **Step 6: Commit**

```bash
git add src/lib/social/tiktokTenantAuth.ts src/lib/social/tiktokTenantAuth.test.ts
git commit -m "feat: adiciona renovacao de token TikTok por tenant"
```

---

### Task 3: Rota `POST /api/tiktok/post`

**Files:**
- Create: `src/app/api/tiktok/post/route.ts`
- Test: `src/app/api/tiktok/post/route.test.ts`

**Interfaces:**
- Consumes: `auth` de `@/auth`; `getPool` de `@/lib/db/pool`; `getBusinessForUser` de `@/lib/db/businesses`; `getValidAccessTokenForBusiness` de `@/lib/social/tiktokTenantAuth` (Task 2); `postToTikTok` de `@/lib/social/tiktok` (Task 1, nova assinatura).
- Produces: rota `POST /api/tiktok/post` que retorna `{ ok: true, postId: string }` (200) ou `{ ok: false, error: string }` (401 sem sessão, 400 corpo inválido/campo faltando, 502 falha na publicação/renovação). Task 4 (formulário do dashboard) chama essa rota via `fetch`.

- [ ] **Step 1: Escrever os testes que devem falhar**

```typescript
// src/app/api/tiktok/post/route.test.ts
import { afterEach, describe, expect, it, vi } from 'vitest';

const { authMock, getBusinessForUserMock, getValidAccessTokenForBusinessMock, postToTikTokMock } = vi.hoisted(
  () => ({
    authMock: vi.fn(),
    getBusinessForUserMock: vi.fn(),
    getValidAccessTokenForBusinessMock: vi.fn(),
    postToTikTokMock: vi.fn(),
  }),
);

vi.mock('@/auth', () => ({ auth: authMock }));
vi.mock('@/lib/db/pool', () => ({ getPool: vi.fn(() => ({})) }));
vi.mock('@/lib/db/businesses', () => ({ getBusinessForUser: getBusinessForUserMock }));
vi.mock('@/lib/social/tiktokTenantAuth', () => ({
  getValidAccessTokenForBusiness: getValidAccessTokenForBusinessMock,
}));
vi.mock('@/lib/social/tiktok', () => ({ postToTikTok: postToTikTokMock }));

import { POST } from './route';

function makeRequest(body: unknown): Request {
  return new Request('https://promopost.example.com/api/tiktok/post', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const VALID_BODY = {
  imageUrl: 'https://x.com/img.jpg',
  title: 'Produto teste',
  description: 'Descrição teste',
};

function stubWebhookBaseUrl() {
  vi.stubEnv('WEBHOOK_BASE_URL', 'https://promopost.example.com');
}

describe('POST /api/tiktok/post', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it('retorna 401 sem sessão', async () => {
    authMock.mockResolvedValue(null);
    const response = await POST(makeRequest(VALID_BODY));
    expect(response.status).toBe(401);
    expect(postToTikTokMock).not.toHaveBeenCalled();
  });

  it('retorna 400 quando falta um campo obrigatório', async () => {
    authMock.mockResolvedValue({ user: { id: 'user-1' } });
    const response = await POST(makeRequest({ imageUrl: 'https://x.com/img.jpg', title: 'Só título' }));
    expect(response.status).toBe(400);
    expect(postToTikTokMock).not.toHaveBeenCalled();
  });

  it('retorna 400 quando a empresa não existe pra esse usuário', async () => {
    authMock.mockResolvedValue({ user: { id: 'user-1' } });
    getBusinessForUserMock.mockResolvedValue(null);
    const response = await POST(makeRequest(VALID_BODY));
    expect(response.status).toBe(400);
    expect(postToTikTokMock).not.toHaveBeenCalled();
  });

  it('monta a URL proxied, publica e retorna o postId em caso de sucesso', async () => {
    stubWebhookBaseUrl();
    authMock.mockResolvedValue({ user: { id: 'user-1' } });
    getBusinessForUserMock.mockResolvedValue({
      id: 'biz-1',
      ownerUserId: 'user-1',
      name: 'Loja',
      createdAt: new Date(),
    });
    getValidAccessTokenForBusinessMock.mockResolvedValue('valid-access-token');
    postToTikTokMock.mockResolvedValue({ postId: 'abc123' });

    const response = await POST(makeRequest(VALID_BODY));
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json).toEqual({ ok: true, postId: 'abc123' });
    expect(getValidAccessTokenForBusinessMock).toHaveBeenCalledWith(expect.anything(), 'biz-1');
    expect(postToTikTokMock).toHaveBeenCalledWith(
      'valid-access-token',
      'https://promopost.example.com/api/tiktok-image-proxy?imageUrl=' + encodeURIComponent('https://x.com/img.jpg'),
      'Produto teste',
      'Descrição teste',
    );
  });

  it('retorna 502 com a mensagem de erro quando a renovação do token falha', async () => {
    stubWebhookBaseUrl();
    authMock.mockResolvedValue({ user: { id: 'user-1' } });
    getBusinessForUserMock.mockResolvedValue({
      id: 'biz-1',
      ownerUserId: 'user-1',
      name: 'Loja',
      createdAt: new Date(),
    });
    getValidAccessTokenForBusinessMock.mockRejectedValue(new Error('Conta do TikTok não conectada'));

    const response = await POST(makeRequest(VALID_BODY));
    const json = await response.json();

    expect(response.status).toBe(502);
    expect(json).toEqual({ ok: false, error: 'Conta do TikTok não conectada' });
    expect(postToTikTokMock).not.toHaveBeenCalled();
  });

  it('retorna 502 com a mensagem de erro quando postToTikTok falha', async () => {
    stubWebhookBaseUrl();
    authMock.mockResolvedValue({ user: { id: 'user-1' } });
    getBusinessForUserMock.mockResolvedValue({
      id: 'biz-1',
      ownerUserId: 'user-1',
      name: 'Loja',
      createdAt: new Date(),
    });
    getValidAccessTokenForBusinessMock.mockResolvedValue('valid-access-token');
    postToTikTokMock.mockRejectedValue(new Error('picture_size_check_failed'));

    const response = await POST(makeRequest(VALID_BODY));
    const json = await response.json();

    expect(response.status).toBe(502);
    expect(json).toEqual({ ok: false, error: 'picture_size_check_failed' });
  });

  it('retorna 500 quando WEBHOOK_BASE_URL não está configurado', async () => {
    authMock.mockResolvedValue({ user: { id: 'user-1' } });
    getBusinessForUserMock.mockResolvedValue({
      id: 'biz-1',
      ownerUserId: 'user-1',
      name: 'Loja',
      createdAt: new Date(),
    });
    const response = await POST(makeRequest(VALID_BODY));
    expect(response.status).toBe(500);
    expect(postToTikTokMock).not.toHaveBeenCalled();
  });

  it('retorna 400 quando o corpo JSON é inválido', async () => {
    authMock.mockResolvedValue({ user: { id: 'user-1' } });
    const response = await POST(
      new Request('https://promopost.example.com/api/tiktok/post', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{not valid json',
      }),
    );
    expect(response.status).toBe(400);
  });
});
```

- [ ] **Step 2: Rodar os testes e confirmar que falham**

Run: `npx vitest run src/app/api/tiktok/post/route.test.ts`
Expected: FAIL — `Cannot find module './route'`

- [ ] **Step 3: Escrever a implementação**

```typescript
// src/app/api/tiktok/post/route.ts
import { auth } from '@/auth';
import { getPool } from '@/lib/db/pool';
import { getBusinessForUser } from '@/lib/db/businesses';
import { getValidAccessTokenForBusiness } from '@/lib/social/tiktokTenantAuth';
import { postToTikTok } from '@/lib/social/tiktok';

function toErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export async function POST(request: Request): Promise<Response> {
  const session = await auth();
  if (!session?.user?.id) {
    return Response.json({ ok: false, error: 'não autorizado' }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ ok: false, error: 'JSON inválido' }, { status: 400 });
  }

  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return Response.json({ ok: false, error: 'JSON inválido' }, { status: 400 });
  }

  const bodyObj = body as { imageUrl?: string; title?: string; description?: string };
  const { imageUrl, title, description } = bodyObj;
  if (!imageUrl || !title || !description) {
    return Response.json(
      { ok: false, error: 'Campos obrigatórios: imageUrl, title, description' },
      { status: 400 },
    );
  }

  const business = await getBusinessForUser(getPool(), session.user.id);
  if (!business) {
    return Response.json({ ok: false, error: 'Empresa não encontrada' }, { status: 400 });
  }

  const baseUrl = process.env.WEBHOOK_BASE_URL;
  if (!baseUrl) {
    return Response.json({ ok: false, error: 'WEBHOOK_BASE_URL não configurado' }, { status: 500 });
  }
  const proxiedImageUrl = `${baseUrl}/api/tiktok-image-proxy?${new URLSearchParams({ imageUrl }).toString()}`;

  try {
    const accessToken = await getValidAccessTokenForBusiness(getPool(), business.id);
    const result = await postToTikTok(accessToken, proxiedImageUrl, title, description);
    return Response.json({ ok: true, postId: result.postId });
  } catch (err) {
    return Response.json({ ok: false, error: toErrorMessage(err) }, { status: 502 });
  }
}
```

- [ ] **Step 4: Rodar os testes e confirmar que passam**

Run: `npx vitest run src/app/api/tiktok/post/route.test.ts`
Expected: PASS (8 testes)

- [ ] **Step 5: Rodar o typecheck**

Run: `npm run typecheck`
Expected: sem erros

- [ ] **Step 6: Commit**

```bash
git add src/app/api/tiktok/post
git commit -m "feat: adiciona rota de publicacao manual no TikTok por tenant"
```

---

### Task 4: Formulário no dashboard

**Files:**
- Create: `src/app/(app)/dashboard/TikTokPostForm.tsx`
- Modify: `src/app/(app)/dashboard/page.tsx`

**Interfaces:**
- Consumes: rota `POST /api/tiktok/post` (Task 3) via `fetch` no client.
- Produces: nada — task terminal deste plano.

Sem teste automatizado — mesma exceção já usada pra toda página/formulário deste projeto (nenhum precedente de teste de componente React, incluindo `src/app/admin/TikTokPostForm.tsx`). Verificação manual no Step 3.

- [ ] **Step 1: Escrever o componente do formulário**

Create `src/app/(app)/dashboard/TikTokPostForm.tsx`:

```typescript
'use client';

import { useState, type FormEvent } from 'react';

type Resultado = { ok: true; postId: string } | { ok: false; error: string };

export default function TikTokPostForm() {
  const [imageUrl, setImageUrl] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [resultado, setResultado] = useState<Resultado | null>(null);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setEnviando(true);
    setResultado(null);
    try {
      const response = await fetch('/api/tiktok/post', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ imageUrl, title, description }),
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
    <div style={{ marginTop: 24, paddingTop: 24, borderTop: '1px solid #e5e5e5' }}>
      <h2 style={{ fontSize: 18, marginBottom: 8 }}>Publicar no TikTok</h2>
      <p style={{ color: '#555', fontSize: 14, marginBottom: 16 }}>
        Sua conta do TikTok precisa estar configurada como <strong>conta privada</strong> (Configurações
        e privacidade → Privacidade) — exigência da TikTok pra apps ainda não auditados.
      </p>
      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          Título
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
            style={{ padding: 8, boxSizing: 'border-box' }}
          />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          Descrição
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            required
            style={{ padding: 8, boxSizing: 'border-box' }}
          />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          URL da imagem
          <input
            type="text"
            value={imageUrl}
            onChange={(e) => setImageUrl(e.target.value)}
            required
            placeholder="https://..."
            style={{ padding: 8, boxSizing: 'border-box' }}
          />
        </label>
        {imageUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={imageUrl}
            alt="Preview"
            style={{ maxWidth: 240, maxHeight: 240, objectFit: 'contain', border: '1px solid #e5e5e5' }}
          />
        )}
        <button type="submit" disabled={enviando} style={{ padding: 12 }}>
          {enviando ? 'Publicando...' : 'Publicar no TikTok'}
        </button>
        {resultado && (
          <p style={{ color: resultado.ok ? '#0a7c2f' : '#b00020' }}>
            {resultado.ok ? 'Publicado com sucesso!' : `Erro: ${resultado.error}`}
          </p>
        )}
      </form>
    </div>
  );
}
```

- [ ] **Step 2: Renderizar o formulário no dashboard**

Modificar `src/app/(app)/dashboard/page.tsx` (ler o arquivo primeiro pra confirmar o conteúdo atual antes de editar):

```typescript
// Antes:
import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { getPool } from '@/lib/db/pool';
import { getBusinessForUser } from '@/lib/db/businesses';
import { getTikTokAccountForBusiness } from '@/lib/db/tiktokAccounts';
// Depois:
import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { getPool } from '@/lib/db/pool';
import { getBusinessForUser } from '@/lib/db/businesses';
import { getTikTokAccountForBusiness } from '@/lib/db/tiktokAccounts';
import TikTokPostForm from './TikTokPostForm';
```

```typescript
// Antes:
      {tiktokAccount ? (
        <>
          <p>TikTok conectado ✅</p>
          <a href="/api/tiktok/connect" style={{ display: 'inline-block', padding: 12 }}>
            Reconectar
          </a>
        </>
      ) : (
// Depois:
      {tiktokAccount ? (
        <>
          <p>TikTok conectado ✅</p>
          <a href="/api/tiktok/connect" style={{ display: 'inline-block', padding: 12 }}>
            Reconectar
          </a>
          <TikTokPostForm />
        </>
      ) : (
```

- [ ] **Step 3: Verificar manualmente**

Pré-requisito: ter uma empresa com TikTok já conectado (Peça 2) em produção ou local.

1. `npm run dev` (ou testar direto em produção depois do deploy).
2. Acessar `/dashboard` logado, com TikTok conectado → confirmar que o formulário novo aparece abaixo de "TikTok conectado ✅", com a nota sobre conta privada visível.
3. Colar uma URL de imagem real → confirmar que a preview aparece abaixo do campo.
4. Preencher título e descrição, clicar em "Publicar no TikTok" → confirmar que o botão mostra "Publicando..." e desabilita durante o envio.
5. Confirmar que a mensagem de sucesso aparece e que o post realmente apareceu na conta TikTok conectada (privada, então só visível logado nela).
6. Rodar `npm run typecheck` uma última vez → sem erros.

- [ ] **Step 4: Commit**

```bash
git add "src/app/(app)/dashboard/TikTokPostForm.tsx" "src/app/(app)/dashboard/page.tsx"
git commit -m "feat: adiciona formulario de publicacao manual no dashboard"
```
