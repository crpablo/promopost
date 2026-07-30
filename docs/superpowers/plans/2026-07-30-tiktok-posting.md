# TikTok Posting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Depois que os outros posts sociais são tentados, postar uma foto do produto no TikTok (título + descrição, mesmo texto das outras redes), como mais um passo *best-effort* e *independente* — com suas próprias credenciais, sem depender da Meta estar configurada.

**Architecture:** Um par token/refresh-token do TikTok (OAuth) fica salvo no Vercel Blob, renovado de forma preguiçosa (só na hora de postar, se estiver perto de expirar). Uma rota nova recebe o redirect do OAuth e faz a primeira troca código→token. `postToTikTok` reaproveita a legenda já montada pra Facebook/Instagram, chamando a Content Posting API da TikTok (`media_type: PHOTO`) com o mesmo padrão init→espera status→resultado já usado pro Instagram.

**Tech Stack:** TikTok Content Posting API (`open.tiktokapis.com`), TikTok OAuth (`www.tiktok.com/v2/auth/authorize/`), Vercel Blob, TypeScript, Vitest.

## Global Constraints

- Node >=24, TypeScript estrito (configs já existentes no projeto).
- Todo texto voltado ao usuário/operador (erros, docs) em português.
- TikTok é *best-effort* e **independente das outras redes** — usa suas próprias variáveis de ambiente (`TIKTOK_*`), configuradas separadamente da Meta. Se a Meta não estiver configurada mas o TikTok estiver, o TikTok ainda deve ser tentado normalmente, e vice-versa. Sem retentativa automática em nenhum passo.
- Até o app passar pela auditoria da TikTok, todo post sai como `privacy_level: "SELF_ONLY"` (forçado pela plataforma) — o código já assume isso explicitamente, não tenta pedir `PUBLIC_TO_EVERYONE`.
- Reaproveita a mesma legenda (`buildSocialCaption`) já usada pra Facebook/Instagram como descrição do post no TikTok — não cria um formato de texto novo.
- Não modifica `src/lib/social/caption.ts`, `src/lib/social/facebook.ts`, `src/lib/social/instagram.ts`, nem `src/app/api/story-image/*` — já corretos e revisados.
- A TikTok exige que a URL de `photo_images` (`PULL_FROM_URL`) esteja num domínio verificado como nosso — `product.imageUrl` aponta pro CDN do Mercado Livre (`mlstatic.com`), que não podemos verificar. Por isso o TikTok **nunca** recebe `product.imageUrl` diretamente: sempre passa por `/api/tiktok-image-proxy` (Task 2), servido do nosso próprio domínio.

---

### Task 1: TikTok Token Store

**Files:**
- Create: `src/lib/social/tiktokTokenStore.ts`
- Test: `src/lib/social/tiktokTokenStore.test.ts`

**Interfaces:**
- Produces: `interface TikTokTokens { accessToken: string; refreshToken: string; expiresAt: number }`, `loadTikTokTokens(): Promise<TikTokTokens | null>`, `saveTikTokTokens(tokens: TikTokTokens): Promise<void>` — usados pela Task 3 e Task 4.

- [ ] **Step 1: Escrever os testes que falham**

Criar `src/lib/social/tiktokTokenStore.test.ts`:

```typescript
import { afterEach, describe, expect, it, vi } from 'vitest';

const { listMock, putMock } = vi.hoisted(() => ({
  listMock: vi.fn(),
  putMock: vi.fn(),
}));

vi.mock('@vercel/blob', () => ({
  list: listMock,
  put: putMock,
}));

import { loadTikTokTokens, saveTikTokTokens } from './tiktokTokenStore';

describe('loadTikTokTokens', () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it('retorna null quando não existe token salvo ainda', async () => {
    listMock.mockResolvedValue({ blobs: [] });

    const tokens = await loadTikTokTokens();

    expect(tokens).toBeNull();
  });

  it('baixa e retorna o token salvo', async () => {
    listMock.mockResolvedValue({
      blobs: [{ pathname: 'tiktok-tokens.json', url: 'https://blob.vercel-storage.com/tiktok-tokens.json' }],
    });
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ accessToken: 'act123', refreshToken: 'rft456', expiresAt: 1234567890 }),
      }),
    );

    const tokens = await loadTikTokTokens();

    expect(tokens).toEqual({ accessToken: 'act123', refreshToken: 'rft456', expiresAt: 1234567890 });
  });

  it('lança erro quando o download do token falha', async () => {
    listMock.mockResolvedValue({
      blobs: [{ pathname: 'tiktok-tokens.json', url: 'https://blob.vercel-storage.com/tiktok-tokens.json' }],
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 }));

    await expect(loadTikTokTokens()).rejects.toThrow('Falha ao carregar token do TikTok: 500');
  });
});

describe('saveTikTokTokens', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('grava o token no pathname fixo, sobrescrevendo o anterior', async () => {
    putMock.mockResolvedValue({ url: 'https://blob.vercel-storage.com/tiktok-tokens.json' });

    await saveTikTokTokens({ accessToken: 'act123', refreshToken: 'rft456', expiresAt: 1234567890 });

    expect(putMock).toHaveBeenCalledWith(
      'tiktok-tokens.json',
      JSON.stringify({ accessToken: 'act123', refreshToken: 'rft456', expiresAt: 1234567890 }),
      expect.objectContaining({ access: 'private', allowOverwrite: true, addRandomSuffix: false }),
    );
  });

  it('lança erro em português quando o upload do token falha', async () => {
    putMock.mockRejectedValue(new Error('network error'));

    await expect(
      saveTikTokTokens({ accessToken: 'act123', refreshToken: 'rft456', expiresAt: 1234567890 }),
    ).rejects.toThrow('Falha ao salvar token do TikTok: network error');
  });
});
```

- [ ] **Step 2: Rodar os testes e confirmar que falham**

Run: `npm test -- tiktokTokenStore`
Expected: FAIL — `Cannot find module './tiktokTokenStore'`

- [ ] **Step 3: Implementar**

Criar `src/lib/social/tiktokTokenStore.ts`:

```typescript
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
```

- [ ] **Step 4: Rodar os testes e confirmar que passam**

Run: `npm test -- tiktokTokenStore`
Expected: PASS (5 testes)

- [ ] **Step 5: Commit**

```bash
git add src/lib/social/tiktokTokenStore.ts src/lib/social/tiktokTokenStore.test.ts
git commit -m "feat: armazenamento do token do TikTok no Vercel Blob"
```

---

### Task 2: Proxy de imagem para o TikTok

**Files:**
- Create: `src/app/api/tiktok-image-proxy/route.ts`
- Test: `src/app/api/tiktok-image-proxy/route.test.ts`

**Interfaces:**
- Produces: `GET /api/tiktok-image-proxy?imageUrl=...` — busca a imagem apontada por `imageUrl` e repassa o conteúdo tal como está (mesmo `content-type`, sem transformação). Usada pela Task 5, que monta essa URL (no nosso próprio domínio, verificável pela TikTok) em vez de passar `product.imageUrl` (domínio `mlstatic.com`, do Mercado Livre) direto pra API da TikTok — ver Global Constraints.
- Reaproveita o mesmo padrão de allowlist de host de `src/app/api/story-image/route.tsx` (`ALLOWED_IMAGE_HOSTS`), mas **não importa nada de lá** — é uma constante própria neste arquivo, já que os dois arquivos não devem depender um do outro.

- [ ] **Step 1: Escrever os testes que falham**

Criar `src/app/api/tiktok-image-proxy/route.test.ts`:

```typescript
import { afterEach, describe, expect, it, vi } from 'vitest';

import { GET } from './route';

describe('GET /api/tiktok-image-proxy', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('busca a imagem e repassa o conteúdo e o content-type', async () => {
    const imageBytes = new Uint8Array([1, 2, 3, 4]);
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        headers: new Headers({ 'content-type': 'image/jpeg' }),
        arrayBuffer: async () => imageBytes.buffer,
      }),
    );

    const request = new Request(
      'https://promopost.example.com/api/tiktok-image-proxy?imageUrl=' +
        encodeURIComponent('https://http2.mlstatic.com/D_1.jpg'),
    );
    const response = await GET(request);
    const body = new Uint8Array(await response.arrayBuffer());

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('image/jpeg');
    expect(body).toEqual(imageBytes);
  });

  it('retorna 400 quando falta o parâmetro imageUrl', async () => {
    const request = new Request('https://promopost.example.com/api/tiktok-image-proxy');
    const response = await GET(request);

    expect(response.status).toBe(400);
  });

  it('retorna 400 quando o host da imagem não é permitido', async () => {
    const request = new Request(
      'https://promopost.example.com/api/tiktok-image-proxy?imageUrl=' +
        encodeURIComponent('https://evil.example.com/x.jpg'),
    );
    const response = await GET(request);

    expect(response.status).toBe(400);
  });

  it('retorna 502 quando a busca da imagem original falha', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404 }));

    const request = new Request(
      'https://promopost.example.com/api/tiktok-image-proxy?imageUrl=' +
        encodeURIComponent('https://http2.mlstatic.com/D_1.jpg'),
    );
    const response = await GET(request);

    expect(response.status).toBe(502);
  });
});
```

- [ ] **Step 2: Rodar os testes e confirmar que falham**

Run: `npm test -- tiktok-image-proxy`
Expected: FAIL — `Cannot find module './route'`

- [ ] **Step 3: Implementar**

Criar `src/app/api/tiktok-image-proxy/route.ts`:

```typescript
const ALLOWED_IMAGE_HOSTS = [/(^|\.)mlstatic\.com$/i];

function isAllowedImageHost(url: string): boolean {
  try {
    const hostname = new URL(url).hostname;
    return ALLOWED_IMAGE_HOSTS.some((pattern) => pattern.test(hostname));
  } catch {
    return false;
  }
}

export async function GET(request: Request): Promise<Response> {
  const { searchParams } = new URL(request.url);
  const imageUrl = searchParams.get('imageUrl');

  if (!imageUrl) {
    return Response.json({ erro: 'Parâmetro obrigatório ausente: imageUrl' }, { status: 400 });
  }
  if (!isAllowedImageHost(imageUrl)) {
    return Response.json({ erro: 'Host da imagem não permitido' }, { status: 400 });
  }

  const upstream = await fetch(imageUrl);
  if (!upstream.ok) {
    return Response.json(
      { erro: `Falha ao buscar a imagem original: ${upstream.status}` },
      { status: 502 },
    );
  }

  const body = await upstream.arrayBuffer();
  const contentType = upstream.headers.get('content-type') ?? 'application/octet-stream';
  return new Response(body, { status: 200, headers: { 'content-type': contentType } });
}
```

- [ ] **Step 4: Rodar os testes e confirmar que passam**

Run: `npm test -- tiktok-image-proxy`
Expected: PASS (4 testes)

- [ ] **Step 5: Commit**

```bash
git add src/app/api/tiktok-image-proxy/route.ts src/app/api/tiktok-image-proxy/route.test.ts
git commit -m "feat: proxy de imagem em domínio próprio para posts do TikTok"
```

---

### Task 3: TikTok Publisher

**Files:**
- Create: `src/lib/social/tiktok.ts`
- Test: `src/lib/social/tiktok.test.ts`

**Interfaces:**
- Consumes: `loadTikTokTokens`, `saveTikTokTokens`, `TikTokTokens` de `./tiktokTokenStore` (Task 1). `SocialPostResult` (`{postId: string}`) de `./facebook` (já existe, reaproveitado — não redeclare).
- Produces: `postToTikTok(imageUrl: string, title: string, description: string): Promise<SocialPostResult>` — usada pela Task 5.
- Variáveis de ambiente: `TIKTOK_CLIENT_KEY`, `TIKTOK_CLIENT_SECRET`.

- [ ] **Step 1: Escrever os testes que falham**

Criar `src/lib/social/tiktok.test.ts`:

```typescript
import { afterEach, describe, expect, it, vi } from 'vitest';

const { loadTikTokTokensMock, saveTikTokTokensMock } = vi.hoisted(() => ({
  loadTikTokTokensMock: vi.fn(),
  saveTikTokTokensMock: vi.fn(),
}));

vi.mock('./tiktokTokenStore', () => ({
  loadTikTokTokens: loadTikTokTokensMock,
  saveTikTokTokens: saveTikTokTokensMock,
}));

import { postToTikTok } from './tiktok';

function stubEnv() {
  vi.stubEnv('TIKTOK_CLIENT_KEY', 'fake-client-key');
  vi.stubEnv('TIKTOK_CLIENT_SECRET', 'fake-client-secret');
}

const VALID_TOKENS = {
  accessToken: 'valid-access-token',
  refreshToken: 'valid-refresh-token',
  expiresAt: Date.now() + 60 * 60 * 1000, // expira em 1h — não precisa renovar
};

describe('postToTikTok', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it('posta com o token salvo, sem renovar, quando ele ainda não está perto de expirar', async () => {
    stubEnv();
    loadTikTokTokensMock.mockResolvedValue(VALID_TOKENS);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: { publish_id: 'pub_1' }, error: { code: 'ok' } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: { status: 'PUBLISH_COMPLETE' }, error: { code: 'ok' } }),
      });
    vi.stubGlobal('fetch', fetchMock);

    const result = await postToTikTok('https://x.com/img.jpg', 'Produto X', 'legenda completa');

    expect(result).toEqual({ postId: 'pub_1' });
    expect(saveTikTokTokensMock).not.toHaveBeenCalled();

    const [initUrl, initOptions] = fetchMock.mock.calls[0];
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

    const [statusUrl, statusOptions] = fetchMock.mock.calls[1];
    expect(statusUrl).toBe('https://open.tiktokapis.com/v2/post/publish/status/fetch/');
    expect(JSON.parse(statusOptions.body)).toEqual({ publish_id: 'pub_1' });
  });

  it('renova o token antes de postar quando ele está perto de expirar', async () => {
    stubEnv();
    loadTikTokTokensMock.mockResolvedValue({
      accessToken: 'old-access-token',
      refreshToken: 'old-refresh-token',
      expiresAt: Date.now() + 60 * 1000, // expira em 1min — precisa renovar
    });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          access_token: 'new-access-token',
          refresh_token: 'new-refresh-token',
          expires_in: 86400,
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: { publish_id: 'pub_1' }, error: { code: 'ok' } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: { status: 'PUBLISH_COMPLETE' }, error: { code: 'ok' } }),
      });
    vi.stubGlobal('fetch', fetchMock);

    const result = await postToTikTok('https://x.com/img.jpg', 'Produto X', 'legenda completa');

    expect(result).toEqual({ postId: 'pub_1' });
    expect(saveTikTokTokensMock).toHaveBeenCalledWith(
      expect.objectContaining({ accessToken: 'new-access-token', refreshToken: 'new-refresh-token' }),
    );

    const [refreshUrl, refreshOptions] = fetchMock.mock.calls[0];
    expect(refreshUrl).toBe('https://open.tiktokapis.com/v2/oauth/token/');
    expect(refreshOptions.body.toString()).toContain('grant_type=refresh_token');
    expect(refreshOptions.body.toString()).toContain('refresh_token=old-refresh-token');

    const [initUrl, initOptions] = fetchMock.mock.calls[1];
    expect(initUrl).toBe('https://open.tiktokapis.com/v2/post/publish/content/init/');
    expect(initOptions.headers.Authorization).toBe('Bearer new-access-token');
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

    await expect(postToTikTok('https://x.com/img.jpg', 'Produto X', 'legenda')).rejects.toThrow(
      'Falha ao renovar token do TikTok',
    );
  });

  it('lança erro quando não existe token salvo (nunca rodou o bootstrap)', async () => {
    stubEnv();
    loadTikTokTokensMock.mockResolvedValue(null);

    await expect(postToTikTok('https://x.com/img.jpg', 'Produto X', 'legenda')).rejects.toThrow(
      'Token do TikTok não configurado',
    );
  });

  it('lança erro quando a criação da publicação falha', async () => {
    stubEnv();
    loadTikTokTokensMock.mockResolvedValue(VALID_TOKENS);
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ error: { code: 'invalid_params', message: 'Imagem inválida' } }),
      }),
    );

    await expect(postToTikTok('https://x.com/img.jpg', 'Produto X', 'legenda')).rejects.toThrow(
      'Falha ao publicar no TikTok: Imagem inválida',
    );
  });

  it('lança erro quando o status da publicação vem como FAILED', async () => {
    stubEnv();
    loadTikTokTokensMock.mockResolvedValue(VALID_TOKENS);
    const fetchMock = vi
      .fn()
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

    await expect(postToTikTok('https://x.com/img.jpg', 'Produto X', 'legenda')).rejects.toThrow(
      'Falha ao publicar no TikTok: picture_size_check_failed',
    );
  });

  it('lança erro quando faltam variáveis de ambiente', async () => {
    loadTikTokTokensMock.mockResolvedValue({
      accessToken: 'x',
      refreshToken: 'y',
      expiresAt: Date.now() - 1000, // força o caminho de renovação, que precisa das env vars
    });

    await expect(postToTikTok('https://x.com/img.jpg', 'Produto X', 'legenda')).rejects.toThrow(
      'Variáveis de ambiente do TikTok ausentes',
    );
  });
});
```

- [ ] **Step 2: Rodar os testes e confirmar que falham**

Run: `npm test -- tiktok.test.ts`
Expected: FAIL — `Cannot find module './tiktok'`

- [ ] **Step 3: Implementar**

Criar `src/lib/social/tiktok.ts`:

```typescript
import type { SocialPostResult } from './facebook';
import { loadTikTokTokens, saveTikTokTokens, type TikTokTokens } from './tiktokTokenStore';

// Renova o token se faltar menos de 5min pra expirar — margem de segurança
// contra o tempo que a chamada de postagem em si pode levar.
const TOKEN_REFRESH_MARGIN_MS = 5 * 60 * 1000;
const STATUS_POLL_INTERVAL_MS = 2000;
const STATUS_POLL_MAX_ATTEMPTS = 10;

async function refreshAccessToken(refreshToken: string): Promise<TikTokTokens> {
  const clientKey = process.env.TIKTOK_CLIENT_KEY;
  const clientSecret = process.env.TIKTOK_CLIENT_SECRET;
  if (!clientKey || !clientSecret) {
    throw new Error('Variáveis de ambiente do TikTok ausentes: TIKTOK_CLIENT_KEY, TIKTOK_CLIENT_SECRET');
  }

  const res = await fetch('https://open.tiktokapis.com/v2/oauth/token/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_key: clientKey,
      client_secret: clientSecret,
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    }),
  });
  const json = await res.json();
  if (!res.ok || !json.access_token) {
    throw new Error(`Falha ao renovar token do TikTok: ${json.error_description ?? res.status}`);
  }

  const tokens: TikTokTokens = {
    accessToken: json.access_token,
    refreshToken: json.refresh_token,
    expiresAt: Date.now() + json.expires_in * 1000,
  };
  await saveTikTokTokens(tokens);
  return tokens;
}

async function getValidAccessToken(): Promise<string> {
  const tokens = await loadTikTokTokens();
  if (!tokens) {
    throw new Error('Token do TikTok não configurado — rode o bootstrap (ver runbook)');
  }
  if (Date.now() < tokens.expiresAt - TOKEN_REFRESH_MARGIN_MS) {
    return tokens.accessToken;
  }
  const refreshed = await refreshAccessToken(tokens.refreshToken);
  return refreshed.accessToken;
}

async function waitForPublishComplete(publishId: string, accessToken: string): Promise<void> {
  for (let attempt = 0; attempt < STATUS_POLL_MAX_ATTEMPTS; attempt++) {
    const res = await fetch('https://open.tiktokapis.com/v2/post/publish/status/fetch/', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json; charset=UTF-8',
      },
      body: JSON.stringify({ publish_id: publishId }),
    });
    const json = await res.json();
    if (!res.ok || json.error?.code !== 'ok') {
      throw new Error(`Falha ao checar status da publicação no TikTok: ${json.error?.message ?? res.status}`);
    }
    if (json.data.status === 'PUBLISH_COMPLETE') {
      return;
    }
    if (json.data.status === 'FAILED') {
      throw new Error(`Falha ao publicar no TikTok: ${json.data.fail_reason ?? 'motivo desconhecido'}`);
    }
    await new Promise((resolve) => setTimeout(resolve, STATUS_POLL_INTERVAL_MS));
  }
  throw new Error('Falha ao publicar no TikTok: tempo esgotado esperando a publicação concluir');
}

export async function postToTikTok(
  imageUrl: string,
  title: string,
  description: string,
): Promise<SocialPostResult> {
  const accessToken = await getValidAccessToken();

  const res = await fetch('https://open.tiktokapis.com/v2/post/publish/content/init/', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json; charset=UTF-8',
    },
    body: JSON.stringify({
      media_type: 'PHOTO',
      post_mode: 'DIRECT_POST',
      post_info: {
        title,
        description,
        // Até o app passar pela auditoria da TikTok, todo post fica
        // restrito a SELF_ONLY de qualquer forma — pedimos isso
        // explicitamente em vez de tentar PUBLIC_TO_EVERYONE.
        privacy_level: 'SELF_ONLY',
        disable_comment: false,
        auto_add_music: false,
        brand_content_toggle: false,
        brand_organic_toggle: false,
      },
      source_info: {
        source: 'PULL_FROM_URL',
        photo_images: [imageUrl],
        photo_cover_index: 0,
      },
    }),
  });
  const json = await res.json();
  if (!res.ok || json.error?.code !== 'ok' || !json.data?.publish_id) {
    throw new Error(`Falha ao publicar no TikTok: ${json.error?.message ?? res.status}`);
  }

  await waitForPublishComplete(json.data.publish_id, accessToken);

  return { postId: json.data.publish_id };
}
```

- [ ] **Step 4: Rodar os testes e confirmar que passam**

Run: `npm test -- tiktok.test.ts`
Expected: PASS (7 testes)

- [ ] **Step 5: Commit**

```bash
git add src/lib/social/tiktok.ts src/lib/social/tiktok.test.ts
git commit -m "feat: publicar foto no TikTok via Content Posting API"
```

---

### Task 4: Rota de callback do OAuth

**Files:**
- Create: `src/app/api/tiktok-oauth-callback/route.ts`
- Test: `src/app/api/tiktok-oauth-callback/route.test.ts`

**Interfaces:**
- Consumes: `saveTikTokTokens` de `@/lib/social/tiktokTokenStore` (Task 1).
- Produces: `GET /api/tiktok-oauth-callback?code=...` — recebe o redirect do OAuth da TikTok, troca o código pelo primeiro par de tokens, salva no Blob. Usada manualmente (você abre a URL de autorização no navegador uma vez) — nenhuma outra task chama essa rota programaticamente.
- Variáveis de ambiente: `TIKTOK_CLIENT_KEY`, `TIKTOK_CLIENT_SECRET`, `TIKTOK_REDIRECT_URI`.

- [ ] **Step 1: Escrever os testes que falham**

Criar `src/app/api/tiktok-oauth-callback/route.test.ts`:

```typescript
import { afterEach, describe, expect, it, vi } from 'vitest';

const { saveTikTokTokensMock } = vi.hoisted(() => ({ saveTikTokTokensMock: vi.fn() }));

vi.mock('@/lib/social/tiktokTokenStore', () => ({ saveTikTokTokens: saveTikTokTokensMock }));

import { GET } from './route';

function stubEnv() {
  vi.stubEnv('TIKTOK_CLIENT_KEY', 'fake-client-key');
  vi.stubEnv('TIKTOK_CLIENT_SECRET', 'fake-client-secret');
  vi.stubEnv('TIKTOK_REDIRECT_URI', 'https://promopost.example.com/api/tiktok-oauth-callback');
}

describe('GET /api/tiktok-oauth-callback', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it('troca o código pelo token e salva, retornando sucesso', async () => {
    stubEnv();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          access_token: 'act123',
          refresh_token: 'rft456',
          expires_in: 86400,
        }),
      }),
    );

    const request = new Request('https://promopost.example.com/api/tiktok-oauth-callback?code=abc123');
    const response = await GET(request);

    expect(response.status).toBe(200);
    expect(saveTikTokTokensMock).toHaveBeenCalledWith(
      expect.objectContaining({ accessToken: 'act123', refreshToken: 'rft456' }),
    );
  });

  it('retorna 400 quando a TikTok manda erro em vez de código', async () => {
    stubEnv();
    const request = new Request(
      'https://promopost.example.com/api/tiktok-oauth-callback?error=access_denied',
    );
    const response = await GET(request);

    expect(response.status).toBe(400);
    expect(saveTikTokTokensMock).not.toHaveBeenCalled();
  });

  it('retorna 400 quando falta o parâmetro code', async () => {
    stubEnv();
    const request = new Request('https://promopost.example.com/api/tiktok-oauth-callback');
    const response = await GET(request);

    expect(response.status).toBe(400);
  });

  it('retorna 500 quando a troca de código por token falha', async () => {
    stubEnv();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        json: async () => ({ error: 'invalid_grant', error_description: 'Código inválido' }),
      }),
    );

    const request = new Request('https://promopost.example.com/api/tiktok-oauth-callback?code=abc123');
    const response = await GET(request);

    expect(response.status).toBe(500);
    expect(saveTikTokTokensMock).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Rodar os testes e confirmar que falham**

Run: `npm test -- tiktok-oauth-callback`
Expected: FAIL — `Cannot find module './route'`

- [ ] **Step 3: Implementar**

Criar `src/app/api/tiktok-oauth-callback/route.ts`:

```typescript
import { saveTikTokTokens } from '@/lib/social/tiktokTokenStore';

export async function GET(request: Request): Promise<Response> {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get('code');
  const error = searchParams.get('error');

  if (error) {
    return new Response(`Autorização negada pela TikTok: ${error}`, { status: 400 });
  }
  if (!code) {
    return new Response('Parâmetro code ausente', { status: 400 });
  }

  const clientKey = process.env.TIKTOK_CLIENT_KEY;
  const clientSecret = process.env.TIKTOK_CLIENT_SECRET;
  const redirectUri = process.env.TIKTOK_REDIRECT_URI;
  if (!clientKey || !clientSecret || !redirectUri) {
    return new Response('Variáveis de ambiente do TikTok ausentes no servidor', { status: 500 });
  }

  const res = await fetch('https://open.tiktokapis.com/v2/oauth/token/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_key: clientKey,
      client_secret: clientSecret,
      code,
      grant_type: 'authorization_code',
      redirect_uri: redirectUri,
    }),
  });
  const json = await res.json();
  if (!res.ok || !json.access_token) {
    return new Response(
      `Falha ao trocar código por token: ${json.error_description ?? res.status}`,
      { status: 500 },
    );
  }

  await saveTikTokTokens({
    accessToken: json.access_token,
    refreshToken: json.refresh_token,
    expiresAt: Date.now() + json.expires_in * 1000,
  });

  return new Response('Conta do TikTok autorizada com sucesso! Pode fechar esta aba.', {
    status: 200,
    headers: { 'content-type': 'text/plain; charset=utf-8' },
  });
}
```

- [ ] **Step 4: Rodar os testes e confirmar que passam**

Run: `npm test -- tiktok-oauth-callback`
Expected: PASS (4 testes)

- [ ] **Step 5: Commit**

```bash
git add src/app/api/tiktok-oauth-callback/route.ts src/app/api/tiktok-oauth-callback/route.test.ts
git commit -m "feat: rota de callback do OAuth do TikTok"
```

---

### Task 5: Integrar o TikTok no webhook

**Files:**
- Modify: `src/app/api/webhook/route.ts`
- Modify: `src/app/api/webhook/route.test.ts`
- Modify: `.env.example`
- Modify: `docs/runbook.md`

**Interfaces:**
- Consumes: `postToTikTok(imageUrl, title, description): Promise<SocialPostResult>` (Task 3). `WEBHOOK_BASE_URL` env var (already used by `buildStoryImageUrl` in the current `route.ts` for the Story image route — Task 2's proxy route reuses the same base URL pattern).
- Produces: resposta do webhook estendida com um quarto campo `tiktok: {ok, postId?, error?}`, ao lado de `facebook`/`instagram`/`story` já existentes.

**Decisão de design importante:** o TikTok tem sua **própria checagem de configuração**, independente da Meta (`isMetaConfigured()`). Se só o TikTok estiver configurado (Meta não), `facebook`/`instagram`/`story` devem vir `{ok:false, error:'não configurado'}` mas `tiktok` deve ser tentado normalmente — e vice-versa. A legenda (`buildSocialCaption`) é montada uma única vez e reaproveitada por Facebook, Instagram feed **e TikTok** (a descrição do post) — só o Story não usa a legenda (continua independente, como já era). Isso exige reestruturar `postToSocialNetworks`: em vez de um único gate `isMetaConfigured()` envolvendo tudo, cada rede vira uma função assíncrona independente com seu próprio gate, todas rodando em paralelo via `Promise.all`.

**Importante:** o TikTok nunca recebe `product.imageUrl` diretamente — a TikTok exige que `photo_images` aponte pra um domínio verificado como nosso, e `product.imageUrl` é do CDN do Mercado Livre (`mlstatic.com`), que não controlamos (ver Task 2 e Global Constraints). O webhook monta a URL proxiada (`${WEBHOOK_BASE_URL}/api/tiktok-image-proxy?imageUrl=...`) e passa essa URL pro `postToTikTok`. Se `WEBHOOK_BASE_URL` não estiver configurado, o TikTok reporta `{ok:false, error:'WEBHOOK_BASE_URL não configurado'}` (mesmo padrão já usado pelo Story).

- [ ] **Step 1: Ler o estado atual do arquivo**

Leia `src/app/api/webhook/route.ts` e `src/app/api/webhook/route.test.ts` por completo antes de editar — o Step 4 abaixo é uma substituição total de `route.ts`, mas confirme visualmente que a estrutura atual (função `postToSocialNetworks`, gate `isMetaConfigured`, promise do Story) bate com o que este plano assume, já que o arquivo pode ter mudado desde a escrita deste plano.

- [ ] **Step 2: Escrever os testes que falham**

Substituir `src/app/api/webhook/route.test.ts` inteiro por (mantém todos os testes já existentes, com `tiktok` adicionado em cada `toEqual`, mais testes novos no fim):

```typescript
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/mercadolivre/parseLink', () => ({ parseItemId: vi.fn() }));
vi.mock('@/lib/mercadolivre/affiliateLink', () => ({ fetchProductAndAffiliateLink: vi.fn() }));
vi.mock('@/lib/content/template', () => ({ buildPostText: vi.fn() }));
vi.mock('@/lib/shopify/publisher', () => ({ publishArticle: vi.fn() }));
vi.mock('@/lib/social/caption', () => ({ buildSocialCaption: vi.fn() }));
vi.mock('@/lib/social/facebook', () => ({ postToFacebook: vi.fn() }));
vi.mock('@/lib/social/instagram', () => ({ postToInstagram: vi.fn(), postStoryToInstagram: vi.fn() }));
vi.mock('@/lib/social/tiktok', () => ({ postToTikTok: vi.fn() }));

import { buildPostText } from '@/lib/content/template';
import { fetchProductAndAffiliateLink } from '@/lib/mercadolivre/affiliateLink';
import { parseItemId } from '@/lib/mercadolivre/parseLink';
import { SessionExpiredError } from '@/lib/pipeline';
import { publishArticle } from '@/lib/shopify/publisher';
import { buildSocialCaption } from '@/lib/social/caption';
import { postToFacebook } from '@/lib/social/facebook';
import { postStoryToInstagram, postToInstagram } from '@/lib/social/instagram';
import { postToTikTok } from '@/lib/social/tiktok';
import { POST } from './route';

function makeRequest(body: unknown, secret = 'correct-secret') {
  return new Request('https://promopost.example.com/api/webhook', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-promopost-secret': secret },
    body: JSON.stringify(body),
  });
}

function stubMetaEnv() {
  vi.stubEnv('META_PAGE_ID', '123456789');
  vi.stubEnv('META_IG_BUSINESS_ACCOUNT_ID', '17841400000000000');
  vi.stubEnv('META_SYSTEM_USER_TOKEN', 'fake-meta-token');
}

function stubWebhookBaseUrl() {
  vi.stubEnv('WEBHOOK_BASE_URL', 'https://promopost.example.com');
}

function stubTikTokEnv() {
  vi.stubEnv('TIKTOK_CLIENT_KEY', 'fake-tiktok-key');
  vi.stubEnv('TIKTOK_CLIENT_SECRET', 'fake-tiktok-secret');
}

const PRODUCT = { title: 'Produto X', price: 99.9, imageUrl: 'https://x.com/img.jpg' };

describe('POST /api/webhook', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it('retorna 401 quando o secret está errado', async () => {
    vi.stubEnv('WEBHOOK_SECRET', 'correct-secret');

    const response = await POST(makeRequest({ link: 'https://x.com' }, 'wrong-secret'));

    expect(response.status).toBe(401);
  });

  it('retorna 200 com a url do post no caminho feliz, e posta no Facebook, Instagram, Story e TikTok', async () => {
    stubMetaEnv();
    stubWebhookBaseUrl();
    stubTikTokEnv();
    vi.stubEnv('WEBHOOK_SECRET', 'correct-secret');
    vi.mocked(parseItemId).mockReturnValue('MLB123');
    vi.mocked(fetchProductAndAffiliateLink).mockResolvedValue({
      product: PRODUCT,
      affiliateLink: 'https://meli.la/abc',
    });
    vi.mocked(buildPostText).mockReturnValue('texto do post');
    vi.mocked(publishArticle).mockResolvedValue({
      url: 'https://loja.myshopify.com/blogs/noticias/produto-x',
    });
    vi.mocked(buildSocialCaption).mockReturnValue('legenda social');
    vi.mocked(postToFacebook).mockResolvedValue({ postId: 'fb-1' });
    vi.mocked(postToInstagram).mockResolvedValue({ postId: 'ig-1' });
    vi.mocked(postStoryToInstagram).mockResolvedValue({ postId: 'story-1' });
    vi.mocked(postToTikTok).mockResolvedValue({ postId: 'tt-1' });

    const response = await POST(makeRequest({ link: 'https://mercadolivre.com.br/MLB123' }));
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json).toEqual({
      postUrl: 'https://loja.myshopify.com/blogs/noticias/produto-x',
      facebook: { ok: true, postId: 'fb-1' },
      instagram: { ok: true, postId: 'ig-1' },
      story: { ok: true, postId: 'story-1' },
      tiktok: { ok: true, postId: 'tt-1' },
    });
    expect(postToFacebook).toHaveBeenCalledWith('https://x.com/img.jpg', 'legenda social');
    expect(postToInstagram).toHaveBeenCalledWith('https://x.com/img.jpg', 'legenda social');
    expect(postToTikTok).toHaveBeenCalledWith(
      'https://promopost.example.com/api/tiktok-image-proxy?imageUrl=https%3A%2F%2Fx.com%2Fimg.jpg',
      'Produto X',
      'legenda social',
    );
  });

  it('retorna postUrl mesmo quando Facebook, Instagram, Story e TikTok falham (best-effort, não derruba o blog)', async () => {
    stubMetaEnv();
    stubWebhookBaseUrl();
    stubTikTokEnv();
    vi.stubEnv('WEBHOOK_SECRET', 'correct-secret');
    vi.mocked(parseItemId).mockReturnValue('MLB123');
    vi.mocked(fetchProductAndAffiliateLink).mockResolvedValue({
      product: PRODUCT,
      affiliateLink: 'https://meli.la/abc',
    });
    vi.mocked(buildPostText).mockReturnValue('texto do post');
    vi.mocked(publishArticle).mockResolvedValue({
      url: 'https://loja.myshopify.com/blogs/noticias/produto-x',
    });
    vi.mocked(buildSocialCaption).mockReturnValue('legenda social');
    vi.mocked(postToFacebook).mockRejectedValue(new Error('Token inválido'));
    vi.mocked(postToInstagram).mockRejectedValue(new Error('Imagem inválida'));
    vi.mocked(postStoryToInstagram).mockRejectedValue(new Error('Story indisponível'));
    vi.mocked(postToTikTok).mockRejectedValue(new Error('Token do TikTok expirado'));

    const response = await POST(makeRequest({ link: 'https://mercadolivre.com.br/MLB123' }));
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json).toEqual({
      postUrl: 'https://loja.myshopify.com/blogs/noticias/produto-x',
      facebook: { ok: false, error: 'Token inválido' },
      instagram: { ok: false, error: 'Imagem inválida' },
      story: { ok: false, error: 'Story indisponível' },
      tiktok: { ok: false, error: 'Token do TikTok expirado' },
    });
  });

  it('retorna 400 com o passo link_parse quando o link é inválido', async () => {
    vi.stubEnv('WEBHOOK_SECRET', 'correct-secret');
    vi.mocked(parseItemId).mockReturnValue(null);

    const response = await POST(makeRequest({ link: 'https://shopee.com.br/x' }));
    const json = await response.json();

    expect(response.status).toBe(400);
    expect(json).toEqual({ passo: 'link_parse', erro: expect.any(String) });
  });

  it('retorna 502 com passo affiliate_link e erro SESSION_EXPIRED quando a sessão expirou', async () => {
    vi.stubEnv('WEBHOOK_SECRET', 'correct-secret');
    vi.mocked(parseItemId).mockReturnValue('MLB123');
    vi.mocked(fetchProductAndAffiliateLink).mockRejectedValue(new SessionExpiredError());

    const response = await POST(makeRequest({ link: 'https://mercadolivre.com.br/MLB123' }));
    const json = await response.json();

    expect(response.status).toBe(502);
    expect(json).toEqual({ passo: 'affiliate_link', erro: 'SESSION_EXPIRED' });
    expect(postToFacebook).not.toHaveBeenCalled();
    expect(postToInstagram).not.toHaveBeenCalled();
    expect(postStoryToInstagram).not.toHaveBeenCalled();
    expect(postToTikTok).not.toHaveBeenCalled();
  });

  it('retorna 400 com erro missing_link quando o body é null', async () => {
    vi.stubEnv('WEBHOOK_SECRET', 'correct-secret');

    const response = await POST(makeRequest(null));
    const json = await response.json();

    expect(response.status).toBe(400);
    expect(json).toEqual({ erro: 'link do produto não informado' });
  });

  it('retorna 200 com o postUrl mesmo quando montar a legenda social falha — e o Story é tentado normalmente, independente da legenda', async () => {
    stubMetaEnv();
    stubWebhookBaseUrl();
    vi.stubEnv('WEBHOOK_SECRET', 'correct-secret');
    vi.mocked(parseItemId).mockReturnValue('MLB123');
    vi.mocked(fetchProductAndAffiliateLink).mockResolvedValue({
      product: PRODUCT,
      affiliateLink: 'https://meli.la/abc',
    });
    vi.mocked(buildPostText).mockReturnValue('texto do post');
    vi.mocked(publishArticle).mockResolvedValue({
      url: 'https://loja.myshopify.com/blogs/noticias/produto-x',
    });
    vi.mocked(buildSocialCaption).mockImplementation(() => {
      throw new Error('produto malformado');
    });
    vi.mocked(postStoryToInstagram).mockResolvedValue({ postId: 'story-1' });

    const response = await POST(makeRequest({ link: 'https://mercadolivre.com.br/MLB123' }));
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json).toEqual({
      postUrl: 'https://loja.myshopify.com/blogs/noticias/produto-x',
      facebook: { ok: false, error: 'produto malformado' },
      instagram: { ok: false, error: 'produto malformado' },
      story: { ok: true, postId: 'story-1' },
      tiktok: { ok: false, error: 'não configurado' },
    });
    expect(postToFacebook).not.toHaveBeenCalled();
    expect(postToInstagram).not.toHaveBeenCalled();
    expect(postStoryToInstagram).toHaveBeenCalledTimes(1);
    expect(postToTikTok).not.toHaveBeenCalled();
  });

  it('retorna story com erro quando WEBHOOK_BASE_URL não está configurado, sem afetar Facebook/Instagram', async () => {
    stubMetaEnv();
    vi.stubEnv('WEBHOOK_SECRET', 'correct-secret');
    vi.mocked(parseItemId).mockReturnValue('MLB123');
    vi.mocked(fetchProductAndAffiliateLink).mockResolvedValue({
      product: PRODUCT,
      affiliateLink: 'https://meli.la/abc',
    });
    vi.mocked(buildPostText).mockReturnValue('texto do post');
    vi.mocked(publishArticle).mockResolvedValue({
      url: 'https://loja.myshopify.com/blogs/noticias/produto-x',
    });
    vi.mocked(buildSocialCaption).mockReturnValue('legenda social');
    vi.mocked(postToFacebook).mockResolvedValue({ postId: 'fb-1' });
    vi.mocked(postToInstagram).mockResolvedValue({ postId: 'ig-1' });

    const response = await POST(makeRequest({ link: 'https://mercadolivre.com.br/MLB123' }));
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json).toEqual({
      postUrl: 'https://loja.myshopify.com/blogs/noticias/produto-x',
      facebook: { ok: true, postId: 'fb-1' },
      instagram: { ok: true, postId: 'ig-1' },
      story: { ok: false, error: 'WEBHOOK_BASE_URL não configurado' },
      tiktok: { ok: false, error: 'não configurado' },
    });
    expect(postStoryToInstagram).not.toHaveBeenCalled();
  });

  it('pula Facebook, Instagram e Story quando as variáveis da Meta não estão configuradas, mas ainda tenta o TikTok se ele estiver configurado', async () => {
    stubTikTokEnv();
    stubWebhookBaseUrl();
    vi.stubEnv('WEBHOOK_SECRET', 'correct-secret');
    vi.mocked(parseItemId).mockReturnValue('MLB123');
    vi.mocked(fetchProductAndAffiliateLink).mockResolvedValue({
      product: PRODUCT,
      affiliateLink: 'https://meli.la/abc',
    });
    vi.mocked(buildPostText).mockReturnValue('texto do post');
    vi.mocked(publishArticle).mockResolvedValue({
      url: 'https://loja.myshopify.com/blogs/noticias/produto-x',
    });
    vi.mocked(buildSocialCaption).mockReturnValue('legenda social');
    vi.mocked(postToTikTok).mockResolvedValue({ postId: 'tt-1' });

    const response = await POST(makeRequest({ link: 'https://mercadolivre.com.br/MLB123' }));
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json).toEqual({
      postUrl: 'https://loja.myshopify.com/blogs/noticias/produto-x',
      facebook: { ok: false, error: 'não configurado' },
      instagram: { ok: false, error: 'não configurado' },
      story: { ok: false, error: 'não configurado' },
      tiktok: { ok: true, postId: 'tt-1' },
    });
    expect(postToFacebook).not.toHaveBeenCalled();
    expect(postToInstagram).not.toHaveBeenCalled();
    expect(postStoryToInstagram).not.toHaveBeenCalled();
    expect(postToTikTok).toHaveBeenCalledWith(
      'https://promopost.example.com/api/tiktok-image-proxy?imageUrl=https%3A%2F%2Fx.com%2Fimg.jpg',
      'Produto X',
      'legenda social',
    );
  });

  it('reporta erro no TikTok quando WEBHOOK_BASE_URL não está configurado, mesmo com o TikTok configurado', async () => {
    stubTikTokEnv();
    vi.stubEnv('WEBHOOK_SECRET', 'correct-secret');
    vi.mocked(parseItemId).mockReturnValue('MLB123');
    vi.mocked(fetchProductAndAffiliateLink).mockResolvedValue({
      product: PRODUCT,
      affiliateLink: 'https://meli.la/abc',
    });
    vi.mocked(buildPostText).mockReturnValue('texto do post');
    vi.mocked(publishArticle).mockResolvedValue({
      url: 'https://loja.myshopify.com/blogs/noticias/produto-x',
    });
    vi.mocked(buildSocialCaption).mockReturnValue('legenda social');

    const response = await POST(makeRequest({ link: 'https://mercadolivre.com.br/MLB123' }));
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.tiktok).toEqual({ ok: false, error: 'WEBHOOK_BASE_URL não configurado' });
    expect(postToTikTok).not.toHaveBeenCalled();
  });

  it('pula o TikTok quando só ele não está configurado, mesmo com a Meta configurada', async () => {
    stubMetaEnv();
    stubWebhookBaseUrl();
    vi.stubEnv('WEBHOOK_SECRET', 'correct-secret');
    vi.mocked(parseItemId).mockReturnValue('MLB123');
    vi.mocked(fetchProductAndAffiliateLink).mockResolvedValue({
      product: PRODUCT,
      affiliateLink: 'https://meli.la/abc',
    });
    vi.mocked(buildPostText).mockReturnValue('texto do post');
    vi.mocked(publishArticle).mockResolvedValue({
      url: 'https://loja.myshopify.com/blogs/noticias/produto-x',
    });
    vi.mocked(buildSocialCaption).mockReturnValue('legenda social');
    vi.mocked(postToFacebook).mockResolvedValue({ postId: 'fb-1' });
    vi.mocked(postToInstagram).mockResolvedValue({ postId: 'ig-1' });
    vi.mocked(postStoryToInstagram).mockResolvedValue({ postId: 'story-1' });

    const response = await POST(makeRequest({ link: 'https://mercadolivre.com.br/MLB123' }));
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.tiktok).toEqual({ ok: false, error: 'não configurado' });
    expect(postToTikTok).not.toHaveBeenCalled();
  });

  it('trunca o título do TikTok em 90 caracteres', async () => {
    stubTikTokEnv();
    stubWebhookBaseUrl();
    vi.stubEnv('WEBHOOK_SECRET', 'correct-secret');
    vi.mocked(parseItemId).mockReturnValue('MLB123');
    const longTitle = 'A'.repeat(120);
    vi.mocked(fetchProductAndAffiliateLink).mockResolvedValue({
      product: { title: longTitle, price: 99.9, imageUrl: 'https://x.com/img.jpg' },
      affiliateLink: 'https://meli.la/abc',
    });
    vi.mocked(buildPostText).mockReturnValue('texto do post');
    vi.mocked(publishArticle).mockResolvedValue({
      url: 'https://loja.myshopify.com/blogs/noticias/produto-x',
    });
    vi.mocked(buildSocialCaption).mockReturnValue('legenda social');
    vi.mocked(postToTikTok).mockResolvedValue({ postId: 'tt-1' });

    await POST(makeRequest({ link: 'https://mercadolivre.com.br/MLB123' }));

    const [, calledTitle] = vi.mocked(postToTikTok).mock.calls[0];
    expect(calledTitle).toHaveLength(90);
    expect(calledTitle).toBe('A'.repeat(90));
  });

  it('repassa coupon e discountedPrice do body pro runPipeline e pra URL da imagem do Story', async () => {
    stubMetaEnv();
    stubWebhookBaseUrl();
    vi.stubEnv('WEBHOOK_SECRET', 'correct-secret');
    vi.mocked(parseItemId).mockReturnValue('https://mercadolivre.com.br/MLB123');
    vi.mocked(fetchProductAndAffiliateLink).mockResolvedValue({
      product: PRODUCT,
      affiliateLink: 'https://meli.la/abc',
    });
    vi.mocked(buildPostText).mockReturnValue('texto do post');
    vi.mocked(publishArticle).mockResolvedValue({
      url: 'https://loja.myshopify.com/blogs/noticias/produto-x',
    });
    vi.mocked(buildSocialCaption).mockReturnValue('legenda social');
    vi.mocked(postToFacebook).mockResolvedValue({ postId: 'fb-1' });
    vi.mocked(postToInstagram).mockResolvedValue({ postId: 'ig-1' });
    vi.mocked(postStoryToInstagram).mockResolvedValue({ postId: 'story-1' });

    await POST(
      makeRequest({
        link: 'https://mercadolivre.com.br/MLB123',
        coupon: 'PROMO10',
        discountedPrice: 79.9,
      }),
    );

    expect(buildPostText).toHaveBeenCalledWith(PRODUCT, 'https://meli.la/abc', 'PROMO10', 79.9);
    expect(buildSocialCaption).toHaveBeenCalledWith(PRODUCT, 'https://meli.la/abc', 'PROMO10', 79.9);

    const [storyImageUrl] = vi.mocked(postStoryToInstagram).mock.calls[0];
    const params = new URL(storyImageUrl).searchParams;
    expect(params.get('coupon')).toBe('PROMO10');
    expect(params.get('discountedPrice')).toBe('79.9');
  });

  it('retorna 400 com erro cupom inválido quando coupon não é string', async () => {
    vi.stubEnv('WEBHOOK_SECRET', 'correct-secret');

    const response = await POST(
      makeRequest({ link: 'https://mercadolivre.com.br/MLB123', coupon: 123 }),
    );
    const json = await response.json();

    expect(response.status).toBe(400);
    expect(json).toEqual({ erro: 'cupom inválido' });
  });

  it('retorna 400 com erro preço com desconto inválido quando discountedPrice não é number', async () => {
    vi.stubEnv('WEBHOOK_SECRET', 'correct-secret');

    const response = await POST(
      makeRequest({ link: 'https://mercadolivre.com.br/MLB123', discountedPrice: null }),
    );
    const json = await response.json();

    expect(response.status).toBe(400);
    expect(json).toEqual({ erro: 'preço com desconto inválido' });
  });
});
```

- [ ] **Step 3: Rodar os testes e confirmar que falham**

Run: `npm test -- route.test.ts` (dentro de `src/app/api/webhook/`)
Expected: FAIL — vários testes falham porque `route.ts` ainda não conhece `postToTikTok` nem tem gate independente por rede.

- [ ] **Step 4: Implementar a integração em `route.ts`**

Substituir `src/app/api/webhook/route.ts` inteiro por:

```typescript
import { buildPostText } from '@/lib/content/template';
import { fetchProductAndAffiliateLink } from '@/lib/mercadolivre/affiliateLink';
import type { Product } from '@/lib/mercadolivre/affiliateLink';
import { parseItemId } from '@/lib/mercadolivre/parseLink';
import { PipelineError, runPipeline } from '@/lib/pipeline';
import { publishArticle } from '@/lib/shopify/publisher';
import { buildSocialCaption } from '@/lib/social/caption';
import { postToFacebook } from '@/lib/social/facebook';
import { postStoryToInstagram, postToInstagram } from '@/lib/social/instagram';
import { postToTikTok } from '@/lib/social/tiktok';

export const maxDuration = 300;

type SocialResult = { ok: true; postId: string } | { ok: false; error: string };

const NAO_CONFIGURADO: SocialResult = { ok: false, error: 'não configurado' };

function isMetaConfigured(): boolean {
  return Boolean(
    process.env.META_PAGE_ID && process.env.META_IG_BUSINESS_ACCOUNT_ID && process.env.META_SYSTEM_USER_TOKEN,
  );
}

function isTikTokConfigured(): boolean {
  return Boolean(process.env.TIKTOK_CLIENT_KEY && process.env.TIKTOK_CLIENT_SECRET);
}

function toErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function buildStoryImageUrl(product: Product, coupon?: string, discountedPrice?: number): string {
  const baseUrl = process.env.WEBHOOK_BASE_URL;
  if (!baseUrl) {
    throw new Error('WEBHOOK_BASE_URL não configurado');
  }
  const params = new URLSearchParams({
    imageUrl: product.imageUrl,
    title: product.title,
    price: String(product.price),
  });
  if (typeof discountedPrice === 'number') {
    params.set('discountedPrice', String(discountedPrice));
  }
  if (coupon) {
    params.set('coupon', coupon);
  }
  return `${baseUrl}/api/story-image?${params.toString()}`;
}

function buildTikTokImageProxyUrl(product: Product): string {
  const baseUrl = process.env.WEBHOOK_BASE_URL;
  if (!baseUrl) {
    throw new Error('WEBHOOK_BASE_URL não configurado');
  }
  const params = new URLSearchParams({ imageUrl: product.imageUrl });
  return `${baseUrl}/api/tiktok-image-proxy?${params.toString()}`;
}

async function postToSocialNetworks(
  product: Product,
  affiliateLink: string,
  coupon?: string,
  discountedPrice?: number,
): Promise<{ facebook: SocialResult; instagram: SocialResult; story: SocialResult; tiktok: SocialResult }> {
  // O Story usa dados brutos do produto, não a legenda — tem seu próprio
  // gate (Meta) e roda totalmente independente do resto.
  const storyResultPromise: Promise<SocialResult> = (async () => {
    if (!isMetaConfigured()) {
      return NAO_CONFIGURADO;
    }
    try {
      const storyImageUrl = buildStoryImageUrl(product, coupon, discountedPrice);
      const r = await postStoryToInstagram(storyImageUrl);
      return { ok: true, postId: r.postId };
    } catch (err) {
      console.error('Erro ao postar Story no Instagram:', err);
      return { ok: false, error: toErrorMessage(err) };
    }
  })();

  // Facebook, Instagram (feed) e TikTok reaproveitam a mesma legenda — só
  // monta ela se pelo menos uma dessas três redes estiver configurada.
  let caption: string | undefined;
  let captionError: SocialResult | undefined;
  if (isMetaConfigured() || isTikTokConfigured()) {
    try {
      caption = buildSocialCaption(product, affiliateLink, coupon, discountedPrice);
    } catch (err) {
      console.error('Erro ao montar legenda social:', err);
      captionError = { ok: false, error: toErrorMessage(err) };
    }
  }

  const facebookPromise: Promise<SocialResult> = (async () => {
    if (!isMetaConfigured()) return NAO_CONFIGURADO;
    if (captionError) return captionError;
    try {
      const r = await postToFacebook(product.imageUrl, caption as string);
      return { ok: true, postId: r.postId };
    } catch (err) {
      console.error('Erro ao postar no Facebook:', err);
      return { ok: false, error: toErrorMessage(err) };
    }
  })();

  const instagramPromise: Promise<SocialResult> = (async () => {
    if (!isMetaConfigured()) return NAO_CONFIGURADO;
    if (captionError) return captionError;
    try {
      const r = await postToInstagram(product.imageUrl, caption as string);
      return { ok: true, postId: r.postId };
    } catch (err) {
      console.error('Erro ao postar no Instagram:', err);
      return { ok: false, error: toErrorMessage(err) };
    }
  })();

  const tiktokPromise: Promise<SocialResult> = (async () => {
    if (!isTikTokConfigured()) return NAO_CONFIGURADO;
    if (captionError) return captionError;
    try {
      const proxiedImageUrl = buildTikTokImageProxyUrl(product);
      const title = product.title.slice(0, 90);
      const r = await postToTikTok(proxiedImageUrl, title, caption as string);
      return { ok: true, postId: r.postId };
    } catch (err) {
      console.error('Erro ao postar no TikTok:', err);
      return { ok: false, error: toErrorMessage(err) };
    }
  })();

  const [facebook, instagram, story, tiktok] = await Promise.all([
    facebookPromise,
    instagramPromise,
    storyResultPromise,
    tiktokPromise,
  ]);

  return { facebook, instagram, story, tiktok };
}

export async function POST(request: Request): Promise<Response> {
  const secret = request.headers.get('x-promopost-secret');
  if (!secret || secret !== process.env.WEBHOOK_SECRET) {
    return Response.json({ erro: 'não autorizado' }, { status: 401 });
  }

  let body: { link?: string; coupon?: string; discountedPrice?: number };
  try {
    body = await request.json();
  } catch {
    return Response.json({ erro: 'corpo da requisição não é JSON válido' }, { status: 400 });
  }

  if (!body?.link) {
    return Response.json({ erro: 'link do produto não informado' }, { status: 400 });
  }

  if (body.coupon !== undefined && typeof body.coupon !== 'string') {
    return Response.json({ erro: 'cupom inválido' }, { status: 400 });
  }
  if (body.discountedPrice !== undefined && typeof body.discountedPrice !== 'number') {
    return Response.json({ erro: 'preço com desconto inválido' }, { status: 400 });
  }

  try {
    const result = await runPipeline(
      body.link,
      {
        parseItemId,
        fetchProductAndAffiliateLink,
        buildPostText,
        publishArticle,
      },
      { coupon: body.coupon, discountedPrice: body.discountedPrice },
    );

    const { facebook, instagram, story, tiktok } = await postToSocialNetworks(
      result.product,
      result.affiliateLink,
      body.coupon,
      body.discountedPrice,
    );

    return Response.json(
      { postUrl: result.postUrl, facebook, instagram, story, tiktok },
      { status: 200 },
    );
  } catch (err) {
    console.error('Erro no pipeline PromoPost:', err);
    if (err instanceof PipelineError) {
      const status = err.step === 'link_parse' ? 400 : 502;
      return Response.json({ passo: err.step, erro: err.code ?? err.message }, { status });
    }
    return Response.json({ erro: 'erro interno' }, { status: 500 });
  }
}
```

- [ ] **Step 5: Rodar os testes e confirmar que passam**

Run: `npm test`
Expected: PASS — suíte inteira.

Run: `npm run typecheck`
Expected: sem erros.

- [ ] **Step 6: Documentar variáveis de ambiente**

Adicionar ao final de `.env.example`:

```bash
# App do TikTok (developers.tiktok.com) — Client Key e Secret.
TIKTOK_CLIENT_KEY=
TIKTOK_CLIENT_SECRET=

# URL pública de callback do OAuth, registrada no app da TikTok.
# Ex: https://promopost.vercel.app/api/tiktok-oauth-callback
TIKTOK_REDIRECT_URI=
```

- [ ] **Step 7: Documentar no runbook**

Adicionar uma nova seção `## 11. TikTok (opcional, sub-projeto separado)` em `docs/runbook.md`, depois da seção 10 (Instagram/Facebook/Stories) existente:

```markdown
## 11. TikTok (opcional, sub-projeto separado)

Cobre a postagem automática da mesma promoção como foto no TikTok, junto com o post do blog e das outras redes (ver `docs/superpowers/specs/2026-07-30-tiktok-posting-design.md`).

**Importante:** até o app passar pela auditoria da TikTok (seção 11.3), todo post sai como privado (`SELF_ONLY`) — só visível na própria conta. Isso é uma restrição da plataforma, não um bug.

### 11.1 Criar o app na TikTok

1. Acesse developers.tiktok.com, crie um app.
2. Adicione o produto "Content Posting API".
3. Anote o **Client Key** e o **Client Secret** — vão em `TIKTOK_CLIENT_KEY`/`TIKTOK_CLIENT_SECRET`.
4. Registre a URL de callback (`https://promopost.vercel.app/api/tiktok-oauth-callback`) como Redirect URI autorizada do app — vai em `TIKTOK_REDIRECT_URI`.
5. Configure a permissão (`scope`) `video.publish`.
6. **Verifique o nosso próprio domínio.** A TikTok só aceita `photo_images` (`PULL_FROM_URL`) de domínios verificados como propriedade sua — mesmo princípio do Google Search Console. Como as fotos de produto vêm originalmente do CDN do Mercado Livre (`mlstatic.com`, que não é nosso e não pode ser verificado), a foto é servida através da nossa própria rota `/api/tiktok-image-proxy` — é o **nosso** domínio (`promopost.vercel.app`, ou o domínio customizado do projeto, se houver) que precisa ser verificado, não o do Mercado Livre. Na área "Content Posting API" > "Domain Verification" do seu app, adicione esse domínio e siga o método de verificação que a TikTok oferecer no momento (arquivo em `/.well-known/` ou registro TXT no DNS — a interface deles muda; siga o passo a passo que aparecer). Sem isso, o `postToTikTok` falha com um erro de URL de imagem não permitida mesmo com tudo o mais configurado corretamente.

### 11.2 Autorizar a conta

Depois de configurar `TIKTOK_CLIENT_KEY`, `TIKTOK_CLIENT_SECRET` e `TIKTOK_REDIRECT_URI` na Vercel e fazer o deploy, monte e abra esta URL no navegador (troque `<client_key>` e `<redirect_uri codificado>`):

```
https://www.tiktok.com/v2/auth/authorize/?client_key=<client_key>&response_type=code&scope=video.publish&redirect_uri=<redirect_uri codificado>&state=promopost
```

Loga com a **conta secundária/comercial dedicada** (mesmo princípio do Telegram/Meta — não a conta pessoal principal) e autoriza. Você é redirecionado pra `/api/tiktok-oauth-callback`, que troca o código pelo primeiro par de tokens e salva no Blob automaticamente — a página mostra "Conta do TikTok autorizada com sucesso!" quando funciona. Não precisa rodar nenhum script local.

O token de acesso renova sozinho (o publisher renova antes de cada postagem se estiver perto de expirar). Só repita esse passo se o token de renovação expirar (365 dias) ou for revogado manualmente.

### 11.3 Submeter o app pra auditoria

Na área "Content Posting API" do seu app no developers.tiktok.com, envie o app pra revisão quando quiser que os posts deixem de ser privados. Não é bloqueante pra usar a integração (os posts saem privados até lá) — pode submeter a qualquer momento, inclusive antes de configurar o resto.

### 11.4 Teste manual

Depois de autorizado (seção 11.2), disparar o webhook normalmente (seção 6) com um produto real e conferir o campo `tiktok` na resposta:

```json
{ "tiktok": { "ok": true, "postId": "..." } }
```

Conferir na conta do TikTok (o post vai estar privado, visível só logado nela).

### 11.5 Se algo falhar

- `tiktok: {ok:false, error:'não configurado'}` — faltam `TIKTOK_CLIENT_KEY`/`TIKTOK_CLIENT_SECRET`.
- `Token do TikTok não configurado` — nunca rodou o passo 11.2, ou o token de renovação expirou/foi revogado; repita o passo 11.2.
- `Falha ao renovar token do TikTok` — mesma causa acima.
- `Falha ao publicar no TikTok: picture_size_check_failed` (ou outro `fail_reason`) — a imagem do produto não passou nas checagens da TikTok; confira se a URL da imagem abre normalmente.
- `tiktok: {ok:false, error:'WEBHOOK_BASE_URL não configurado'}` — falta a variável `WEBHOOK_BASE_URL` (mesma usada pela seção 10.5), necessária pra montar a URL do `/api/tiktok-image-proxy`.
- Erro de URL de imagem não permitida vindo da própria TikTok — o domínio do passo 11.1.6 ainda não foi verificado (a verificação pode levar um tempo pra propagar depois de configurada).
```

- [ ] **Step 8: Commit**

```bash
git add src/app/api/webhook/route.ts src/app/api/webhook/route.test.ts .env.example docs/runbook.md
git commit -m "feat: postar foto no TikTok junto com as outras redes (best-effort, gate independente)"
```
