# PromoPost MVP — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a single Vercel serverless endpoint that turns a Mercado Livre product link into a published (draft) Shopify blog article, using a Vercel Sandbox + Playwright to generate the affiliate link.

**Architecture:** One Next.js App Router route (`POST /api/webhook`) runs a 4-step pipeline synchronously in a single request: fetch product data from the Mercado Livre public API, generate the affiliate link via a headless-browser automation running inside a persistent Vercel Sandbox, build post text from a fixed template, and publish a draft article via the Shopify Admin GraphQL API. Session cookies for the Mercado Livre affiliate portal are bootstrapped once locally and stored in Vercel Blob.

**Tech Stack:** Next.js (App Router) + TypeScript, Vitest, `@vercel/blob`, `@vercel/sandbox`, Playwright, Shopify Admin GraphQL API (`2026-04`).

## Global Constraints

- Runtime alvo: Node.js 24 (compatível com `runtime: "node24"` do Vercel Sandbox).
- TypeScript em modo `strict`.
- Vercel Function timeout: 300s, declarado explicitamente via `export const maxDuration = 300` na rota.
- Artigos Shopify são sempre criados com `isPublished: false` (rascunho) neste MVP — publicar de verdade é ação manual do usuário no admin Shopify. Isso vale tanto em teste quanto em uso real; auto-publicar fica para uma fase futura, fora deste plano.
- Sem retry automático em nenhum passo do pipeline — uma falha aparece na resposta HTTP e o reenvio é manual.
- Framework de teste: Vitest.
- Todo texto de post/erro voltado ao usuário fica em português, consistente com o resto do produto.

---

## File Structure

```
package.json
tsconfig.json
next.config.mjs
vitest.config.ts
.env.example
scripts/
  bootstrap-session.mjs        # login manual local, salva sessão no Vercel Blob
src/
  app/
    api/
      webhook/
        route.ts               # handler HTTP, orquestra o pipeline
        route.test.ts
  lib/
    pipeline.ts                 # orquestração + tipos de erro compartilhados
    pipeline.test.ts
    mercadolivre/
      parseLink.ts               # extrai o item ID do link
      parseLink.test.ts
      productFetcher.ts          # busca título/preço/imagem na API pública ML
      productFetcher.test.ts
      affiliateLink.ts            # orquestra a Vercel Sandbox + Playwright
      affiliateLink.test.ts
      generate-link.playwright.mjs  # script que roda DENTRO da sandbox
    content/
      template.ts                # monta o texto do post
      template.test.ts
    session/
      sessionStore.ts             # load/save da sessão ML no Vercel Blob
      sessionStore.test.ts
    shopify/
      publisher.ts                 # cria o artigo via Admin GraphQL API
      publisher.test.ts
docs/
  runbook.md                     # checklist de validação ponta-a-ponta
```

---

### Task 1: Project scaffold + parser de link Mercado Livre

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `next.config.mjs`
- Create: `vitest.config.ts`
- Create: `.env.example`
- Create: `src/lib/mercadolivre/parseLink.ts`
- Test: `src/lib/mercadolivre/parseLink.test.ts`

**Interfaces:**
- Produces: `parseItemId(link: string): string | null` — exportada de `src/lib/mercadolivre/parseLink.ts`. Retorna o ID normalizado (`MLB<dígitos>`) ou `null` se o link não for reconhecível como produto Mercado Livre.

- [ ] **Step 1: Criar `package.json`**

```json
{
  "name": "promopost",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "next": "^15.5.0",
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "@vercel/blob": "^1.0.0",
    "@vercel/sandbox": "^2.0.0",
    "ms": "^2.1.3",
    "playwright": "^1.48.0"
  },
  "devDependencies": {
    "typescript": "^5.6.0",
    "@types/node": "^22.0.0",
    "@types/react": "^19.0.0",
    "@types/ms": "^0.7.34",
    "vitest": "^2.1.0"
  }
}
```

- [ ] **Step 2: Criar `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["dom", "dom.iterable", "esnext"],
    "allowJs": false,
    "skipLibCheck": true,
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "preserve",
    "incremental": true,
    "baseUrl": ".",
    "paths": {
      "@/*": ["./src/*"]
    },
    "plugins": [{ "name": "next" }]
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
```

- [ ] **Step 3: Criar `next.config.mjs`**

```js
/** @type {import('next').NextConfig} */
const nextConfig = {};

export default nextConfig;
```

- [ ] **Step 4: Criar `vitest.config.ts`**

```ts
import path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
```

- [ ] **Step 5: Criar `.env.example`**

```
# Segredo compartilhado que o chamador do webhook deve enviar no header x-promopost-secret
WEBHOOK_SECRET=

# Token de leitura/escrita do Vercel Blob (dashboard Vercel > Storage > Blob)
BLOB_READ_WRITE_TOKEN=

# URL do blob privado com a sessão logada do painel de afiliados Mercado Livre
# (gerado por scripts/bootstrap-session.mjs, ver Task 9)
ML_SESSION_BLOB_URL=

# Domínio da loja Shopify, ex: sua-loja.myshopify.com
SHOPIFY_SHOP_DOMAIN=

# Access token de app customizado Shopify com escopo write_content
SHOPIFY_ADMIN_ACCESS_TOKEN=

# GID do blog onde os artigos serão criados, ex: gid://shopify/Blog/123456789
SHOPIFY_BLOG_ID=
```

- [ ] **Step 6: Instalar dependências**

Run: `npm install`
Expected: instala sem erro, cria `package-lock.json` e `node_modules/`.

- [ ] **Step 7: Escrever o teste que falha primeiro**

Create `src/lib/mercadolivre/parseLink.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { parseItemId } from './parseLink';

describe('parseItemId', () => {
  it('extrai o ID de um link com formato produto.mercadolivre.com.br', () => {
    const link = 'https://produto.mercadolivre.com.br/MLB-1234567890-produto-exemplo-_JM';
    expect(parseItemId(link)).toBe('MLB1234567890');
  });

  it('extrai o ID de um link com formato /p/', () => {
    const link = 'https://www.mercadolivre.com.br/produto-exemplo/p/MLB12345678';
    expect(parseItemId(link)).toBe('MLB12345678');
  });

  it('extrai o ID sem hífen', () => {
    const link = 'https://www.mercadolivre.com.br/MLB1234567890';
    expect(parseItemId(link)).toBe('MLB1234567890');
  });

  it('retorna null para link que não é do Mercado Livre', () => {
    const link = 'https://www.shopee.com.br/produto-x';
    expect(parseItemId(link)).toBeNull();
  });

  it('retorna null para string vazia', () => {
    expect(parseItemId('')).toBeNull();
  });
});
```

- [ ] **Step 8: Rodar o teste e confirmar que falha**

Run: `npx vitest run src/lib/mercadolivre/parseLink.test.ts`
Expected: FAIL — `Cannot find module './parseLink'` (o arquivo ainda não existe).

- [ ] **Step 9: Implementar `parseItemId`**

Create `src/lib/mercadolivre/parseLink.ts`:

```ts
export function parseItemId(link: string): string | null {
  const match = link.match(/MLB-?(\d{6,})/i);
  if (!match) {
    return null;
  }
  return `MLB${match[1]}`;
}
```

- [ ] **Step 10: Rodar o teste e confirmar que passa**

Run: `npx vitest run src/lib/mercadolivre/parseLink.test.ts`
Expected: PASS (5 testes).

- [ ] **Step 11: Commit**

```bash
git add package.json tsconfig.json next.config.mjs vitest.config.ts .env.example src/lib/mercadolivre/parseLink.ts src/lib/mercadolivre/parseLink.test.ts package-lock.json
git commit -m "feat: scaffold projeto + parser de link Mercado Livre"
```

---

### Task 2: Product Fetcher

**Files:**
- Create: `src/lib/mercadolivre/productFetcher.ts`
- Test: `src/lib/mercadolivre/productFetcher.test.ts`

**Interfaces:**
- Consumes: nada (chama a API pública do Mercado Livre diretamente via `fetch` global).
- Produces: `interface Product { title: string; price: number; imageUrl: string }` e `async function fetchProduct(itemId: string): Promise<Product>`, exportadas de `src/lib/mercadolivre/productFetcher.ts`.

- [ ] **Step 1: Escrever o teste que falha primeiro**

Create `src/lib/mercadolivre/productFetcher.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchProduct } from './productFetcher';

describe('fetchProduct', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('retorna título, preço e imagem a partir da API pública do Mercado Livre', async () => {
    const fakeResponse = {
      title: 'Fone de Ouvido Bluetooth XYZ',
      price: 149.9,
      thumbnail: 'https://http2.mlstatic.com/thumb.jpg',
      pictures: [{ secure_url: 'https://http2.mlstatic.com/full.jpg' }],
    };
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => fakeResponse,
    });
    vi.stubGlobal('fetch', fetchMock);

    const product = await fetchProduct('MLB1234567890');

    expect(fetchMock).toHaveBeenCalledWith('https://api.mercadolibre.com/items/MLB1234567890');
    expect(product).toEqual({
      title: 'Fone de Ouvido Bluetooth XYZ',
      price: 149.9,
      imageUrl: 'https://http2.mlstatic.com/full.jpg',
    });
  });

  it('usa thumbnail quando não há pictures', async () => {
    const fakeResponse = {
      title: 'Produto sem fotos extras',
      price: 50,
      thumbnail: 'https://http2.mlstatic.com/thumb.jpg',
      pictures: [],
    };
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: async () => fakeResponse }),
    );

    const product = await fetchProduct('MLB999');

    expect(product.imageUrl).toBe('https://http2.mlstatic.com/thumb.jpg');
  });

  it('lança erro quando a API responde com status de erro', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404 }));

    await expect(fetchProduct('MLB000')).rejects.toThrow('Mercado Livre item lookup failed: 404');
  });
});
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

Run: `npx vitest run src/lib/mercadolivre/productFetcher.test.ts`
Expected: FAIL — `Cannot find module './productFetcher'`.

- [ ] **Step 3: Implementar `fetchProduct`**

Create `src/lib/mercadolivre/productFetcher.ts`:

```ts
export interface Product {
  title: string;
  price: number;
  imageUrl: string;
}

export async function fetchProduct(itemId: string): Promise<Product> {
  const res = await fetch(`https://api.mercadolibre.com/items/${itemId}`);
  if (!res.ok) {
    throw new Error(`Mercado Livre item lookup failed: ${res.status}`);
  }
  const data = await res.json();
  const imageUrl = data.pictures?.[0]?.secure_url || data.thumbnail;
  return {
    title: data.title,
    price: data.price,
    imageUrl,
  };
}
```

- [ ] **Step 4: Rodar o teste e confirmar que passa**

Run: `npx vitest run src/lib/mercadolivre/productFetcher.test.ts`
Expected: PASS (3 testes).

- [ ] **Step 5: Commit**

```bash
git add src/lib/mercadolivre/productFetcher.ts src/lib/mercadolivre/productFetcher.test.ts
git commit -m "feat: buscar dado de produto na API pública do Mercado Livre"
```

---

### Task 3: Content Templater

**Files:**
- Create: `src/lib/content/template.ts`
- Test: `src/lib/content/template.test.ts`

**Interfaces:**
- Consumes: `Product` de `src/lib/mercadolivre/productFetcher.ts` (campos `title`, `price`).
- Produces: `buildPostText(product: Product, affiliateLink: string): string`, exportada de `src/lib/content/template.ts`.

- [ ] **Step 1: Escrever o teste que falha primeiro**

Create `src/lib/content/template.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { buildPostText } from './template';

describe('buildPostText', () => {
  it('monta o texto no formato [TÍTULO] por R$[PREÇO] — confira: [LINK]', () => {
    const text = buildPostText(
      { title: 'Fone de Ouvido Bluetooth XYZ', price: 149.9, imageUrl: 'https://x.com/img.jpg' },
      'https://mercadolivre.com/sec/abc123',
    );
    expect(text).toBe(
      'Fone de Ouvido Bluetooth XYZ por R$149,90 — confira: https://mercadolivre.com/sec/abc123',
    );
  });

  it('formata preço inteiro com duas casas decimais', () => {
    const text = buildPostText(
      { title: 'Produto X', price: 200, imageUrl: 'https://x.com/img.jpg' },
      'https://mercadolivre.com/sec/xyz',
    );
    expect(text).toContain('R$200,00');
  });
});
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

Run: `npx vitest run src/lib/content/template.test.ts`
Expected: FAIL — `Cannot find module './template'`.

- [ ] **Step 3: Implementar `buildPostText`**

Create `src/lib/content/template.ts`:

```ts
import type { Product } from '../mercadolivre/productFetcher';

export function buildPostText(product: Product, affiliateLink: string): string {
  const price = product.price.toLocaleString('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `${product.title} por R$${price} — confira: ${affiliateLink}`;
}
```

- [ ] **Step 4: Rodar o teste e confirmar que passa**

Run: `npx vitest run src/lib/content/template.test.ts`
Expected: PASS (2 testes).

- [ ] **Step 5: Commit**

```bash
git add src/lib/content/template.ts src/lib/content/template.test.ts
git commit -m "feat: gerar texto do post com template fixo"
```

---

### Task 4: Session Store (Vercel Blob)

**Files:**
- Create: `src/lib/session/sessionStore.ts`
- Test: `src/lib/session/sessionStore.test.ts`

**Interfaces:**
- Consumes: `put` de `@vercel/blob` (só em `saveSession`).
- Produces: `async function saveSession(buffer: Buffer): Promise<{ url: string }>` e `async function loadSession(): Promise<Buffer>`, exportadas de `src/lib/session/sessionStore.ts`.

- [ ] **Step 1: Escrever o teste que falha primeiro**

Create `src/lib/session/sessionStore.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@vercel/blob', () => ({
  put: vi.fn().mockResolvedValue({ url: 'https://blob.vercel-storage.com/ml-session-abc.json' }),
}));

import { put } from '@vercel/blob';
import { loadSession, saveSession } from './sessionStore';

describe('saveSession', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('envia o buffer pro Vercel Blob com access private e retorna a url', async () => {
    const buffer = Buffer.from('{"cookies":[]}');
    const result = await saveSession(buffer);

    expect(put).toHaveBeenCalledWith(
      'ml-session.json',
      buffer,
      expect.objectContaining({ access: 'private', allowOverwrite: true }),
    );
    expect(result.url).toBe('https://blob.vercel-storage.com/ml-session-abc.json');
  });
});

describe('loadSession', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('baixa a sessão da url configurada usando o token como bearer', async () => {
    vi.stubEnv('ML_SESSION_BLOB_URL', 'https://blob.vercel-storage.com/ml-session-abc.json');
    vi.stubEnv('BLOB_READ_WRITE_TOKEN', 'fake-token');

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: async () => new TextEncoder().encode('{"cookies":[]}').buffer,
    });
    vi.stubGlobal('fetch', fetchMock);

    const buffer = await loadSession();

    expect(fetchMock).toHaveBeenCalledWith('https://blob.vercel-storage.com/ml-session-abc.json', {
      headers: { authorization: 'Bearer fake-token' },
    });
    expect(buffer.toString()).toBe('{"cookies":[]}');
  });

  it('lança erro quando ML_SESSION_BLOB_URL não está configurada', async () => {
    vi.stubEnv('ML_SESSION_BLOB_URL', '');
    await expect(loadSession()).rejects.toThrow('ML_SESSION_BLOB_URL não configurada');
  });
});
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

Run: `npx vitest run src/lib/session/sessionStore.test.ts`
Expected: FAIL — `Cannot find module './sessionStore'`.

- [ ] **Step 3: Implementar `saveSession` e `loadSession`**

Create `src/lib/session/sessionStore.ts`:

```ts
import { put } from '@vercel/blob';

const SESSION_BLOB_PATHNAME = 'ml-session.json';

export async function saveSession(buffer: Buffer): Promise<{ url: string }> {
  const blob = await put(SESSION_BLOB_PATHNAME, buffer, {
    access: 'private',
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: 'application/json',
    token: process.env.BLOB_READ_WRITE_TOKEN,
  });
  return { url: blob.url };
}

export async function loadSession(): Promise<Buffer> {
  const url = process.env.ML_SESSION_BLOB_URL;
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!url) {
    throw new Error('ML_SESSION_BLOB_URL não configurada');
  }
  const res = await fetch(url, {
    headers: { authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    throw new Error(`Falha ao carregar sessão do Blob: ${res.status}`);
  }
  const arrayBuffer = await res.arrayBuffer();
  return Buffer.from(arrayBuffer);
}
```

- [ ] **Step 4: Rodar o teste e confirmar que passa**

Run: `npx vitest run src/lib/session/sessionStore.test.ts`
Expected: PASS (3 testes).

- [ ] **Step 5: Commit**

```bash
git add src/lib/session/sessionStore.ts src/lib/session/sessionStore.test.ts
git commit -m "feat: load/save da sessao Mercado Livre no Vercel Blob"
```

---

### Task 5: Shopify Publisher

**Files:**
- Create: `src/lib/shopify/publisher.ts`
- Test: `src/lib/shopify/publisher.test.ts`

**Interfaces:**
- Consumes: env vars `SHOPIFY_SHOP_DOMAIN`, `SHOPIFY_ADMIN_ACCESS_TOKEN`, `SHOPIFY_BLOG_ID`.
- Produces: `interface PublishResult { url: string }` e `async function publishArticle(title: string, body: string, imageUrl: string): Promise<PublishResult>`, exportadas de `src/lib/shopify/publisher.ts`.

- [ ] **Step 1: Escrever o teste que falha primeiro**

Create `src/lib/shopify/publisher.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from 'vitest';
import { publishArticle } from './publisher';

function stubEnv() {
  vi.stubEnv('SHOPIFY_SHOP_DOMAIN', 'minha-loja.myshopify.com');
  vi.stubEnv('SHOPIFY_ADMIN_ACCESS_TOKEN', 'shpat_fake');
  vi.stubEnv('SHOPIFY_BLOG_ID', 'gid://shopify/Blog/123');
}

describe('publishArticle', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('cria o artigo como rascunho e retorna a url montada', async () => {
    stubEnv();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: {
          articleCreate: {
            article: {
              id: 'gid://shopify/Article/999',
              handle: 'produto-x',
              blog: { handle: 'noticias' },
            },
            userErrors: [],
          },
        },
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await publishArticle(
      'Produto X',
      'Produto X por R$99,90 — confira: https://x.com',
      'https://x.com/img.jpg',
    );

    expect(result.url).toBe('https://minha-loja.myshopify.com/blogs/noticias/produto-x');

    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe('https://minha-loja.myshopify.com/admin/api/2026-04/graphql.json');
    expect(options.headers['X-Shopify-Access-Token']).toBe('shpat_fake');
    const parsedBody = JSON.parse(options.body);
    expect(parsedBody.variables.article.isPublished).toBe(false);
    expect(parsedBody.variables.article.blogId).toBe('gid://shopify/Blog/123');
  });

  it('lança erro quando a API retorna userErrors', async () => {
    stubEnv();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          data: {
            articleCreate: {
              article: null,
              userErrors: [{ field: ['blogId'], message: 'Blog não encontrado' }],
            },
          },
        }),
      }),
    );

    await expect(
      publishArticle('Produto X', 'texto', 'https://x.com/img.jpg'),
    ).rejects.toThrow('Blog não encontrado');
  });

  it('lança erro quando faltam variáveis de ambiente', async () => {
    await expect(publishArticle('T', 'B', 'https://x.com/img.jpg')).rejects.toThrow(
      'Missing Shopify env vars',
    );
  });
});
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

Run: `npx vitest run src/lib/shopify/publisher.test.ts`
Expected: FAIL — `Cannot find module './publisher'`.

- [ ] **Step 3: Implementar `publishArticle`**

Create `src/lib/shopify/publisher.ts`:

```ts
export interface PublishResult {
  url: string;
}

interface ShopifyConfig {
  shopDomain: string;
  accessToken: string;
  blogId: string;
}

function getConfig(): ShopifyConfig {
  const shopDomain = process.env.SHOPIFY_SHOP_DOMAIN;
  const accessToken = process.env.SHOPIFY_ADMIN_ACCESS_TOKEN;
  const blogId = process.env.SHOPIFY_BLOG_ID;
  if (!shopDomain || !accessToken || !blogId) {
    throw new Error(
      'Missing Shopify env vars: SHOPIFY_SHOP_DOMAIN, SHOPIFY_ADMIN_ACCESS_TOKEN, SHOPIFY_BLOG_ID',
    );
  }
  return { shopDomain, accessToken, blogId };
}

const ARTICLE_CREATE_MUTATION = `
  mutation CreateArticle($article: ArticleCreateInput!) {
    articleCreate(article: $article) {
      article {
        id
        handle
        blog {
          handle
        }
      }
      userErrors {
        field
        message
      }
    }
  }
`;

export async function publishArticle(
  title: string,
  body: string,
  imageUrl: string,
): Promise<PublishResult> {
  const config = getConfig();

  const res = await fetch(`https://${config.shopDomain}/admin/api/2026-04/graphql.json`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': config.accessToken,
    },
    body: JSON.stringify({
      query: ARTICLE_CREATE_MUTATION,
      variables: {
        article: {
          blogId: config.blogId,
          title: title.slice(0, 255),
          author: { name: 'PromoPost' },
          body: `<p>${body}</p>`,
          isPublished: false,
          image: imageUrl ? { url: imageUrl } : undefined,
        },
      },
    }),
  });

  if (!res.ok) {
    throw new Error(`Shopify API request failed: ${res.status}`);
  }

  const json = await res.json();
  const userErrors = json.data?.articleCreate?.userErrors ?? [];
  if (userErrors.length > 0) {
    throw new Error(`Shopify userErrors: ${userErrors.map((e: { message: string }) => e.message).join('; ')}`);
  }

  const article = json.data?.articleCreate?.article;
  if (!article) {
    throw new Error('Shopify articleCreate returned no article');
  }

  return { url: `https://${config.shopDomain}/blogs/${article.blog.handle}/${article.handle}` };
}
```

- [ ] **Step 4: Rodar o teste e confirmar que passa**

Run: `npx vitest run src/lib/shopify/publisher.test.ts`
Expected: PASS (3 testes).

- [ ] **Step 5: Commit**

```bash
git add src/lib/shopify/publisher.ts src/lib/shopify/publisher.test.ts
git commit -m "feat: publicar artigo rascunho via Shopify Admin GraphQL API"
```

---

### Task 6: Pipeline orchestration

**Files:**
- Create: `src/lib/pipeline.ts`
- Test: `src/lib/pipeline.test.ts`

**Interfaces:**
- Consumes: `Product` de `src/lib/mercadolivre/productFetcher.ts`.
- Produces: `type PipelineStep`, `class PipelineError extends Error { step: PipelineStep; code?: string }`, `class SessionExpiredError extends Error`, `interface PipelineDeps`, `interface PipelineResult { postUrl: string }`, `async function runPipeline(link: string, deps: PipelineDeps): Promise<PipelineResult>` — todas exportadas de `src/lib/pipeline.ts`. `SessionExpiredError` é usada pela Task 7 (`affiliateLink.ts`) e pela Task 8 (`route.ts`, indiretamente via `PipelineError.code`).

- [ ] **Step 1: Escrever o teste que falha primeiro**

Create `src/lib/pipeline.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { SessionExpiredError, runPipeline, type PipelineDeps } from './pipeline';

function makeDeps(overrides: Partial<PipelineDeps> = {}): PipelineDeps {
  return {
    parseItemId: vi.fn().mockReturnValue('MLB123'),
    fetchProduct: vi
      .fn()
      .mockResolvedValue({ title: 'Produto X', price: 99.9, imageUrl: 'https://x.com/img.jpg' }),
    generateAffiliateLink: vi.fn().mockResolvedValue('https://mercadolivre.com/sec/abc'),
    buildPostText: vi
      .fn()
      .mockReturnValue('Produto X por R$99,90 — confira: https://mercadolivre.com/sec/abc'),
    publishArticle: vi
      .fn()
      .mockResolvedValue({ url: 'https://loja.myshopify.com/blogs/noticias/produto-x' }),
    ...overrides,
  };
}

describe('runPipeline', () => {
  it('roda os 4 passos em ordem e retorna a url do post', async () => {
    const deps = makeDeps();

    const result = await runPipeline('https://mercadolivre.com.br/MLB123', deps);

    expect(result).toEqual({ postUrl: 'https://loja.myshopify.com/blogs/noticias/produto-x' });
    expect(deps.fetchProduct).toHaveBeenCalledWith('MLB123');
    expect(deps.generateAffiliateLink).toHaveBeenCalledWith('https://mercadolivre.com.br/MLB123');
    expect(deps.publishArticle).toHaveBeenCalledWith(
      'Produto X',
      'Produto X por R$99,90 — confira: https://mercadolivre.com/sec/abc',
      'https://x.com/img.jpg',
    );
  });

  it('lança PipelineError no passo link_parse quando o link não é reconhecido', async () => {
    const deps = makeDeps({ parseItemId: vi.fn().mockReturnValue(null) });

    await expect(runPipeline('https://shopee.com.br/x', deps)).rejects.toMatchObject({
      step: 'link_parse',
    });
  });

  it('lança PipelineError no passo product_fetch quando a busca falha', async () => {
    const deps = makeDeps({ fetchProduct: vi.fn().mockRejectedValue(new Error('404')) });

    await expect(runPipeline('https://mercadolivre.com.br/MLB123', deps)).rejects.toMatchObject({
      step: 'product_fetch',
      message: '404',
    });
  });

  it('lança PipelineError com code SESSION_EXPIRED quando a sessão do ML expirou', async () => {
    const deps = makeDeps({
      generateAffiliateLink: vi.fn().mockRejectedValue(new SessionExpiredError()),
    });

    await expect(runPipeline('https://mercadolivre.com.br/MLB123', deps)).rejects.toMatchObject({
      step: 'affiliate_link',
      code: 'SESSION_EXPIRED',
    });
  });

  it('lança PipelineError no passo shopify_publish quando a publicação falha', async () => {
    const deps = makeDeps({ publishArticle: vi.fn().mockRejectedValue(new Error('rate limit')) });

    await expect(runPipeline('https://mercadolivre.com.br/MLB123', deps)).rejects.toMatchObject({
      step: 'shopify_publish',
    });
  });
});
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

Run: `npx vitest run src/lib/pipeline.test.ts`
Expected: FAIL — `Cannot find module './pipeline'`.

- [ ] **Step 3: Implementar `runPipeline`**

Create `src/lib/pipeline.ts`:

```ts
import type { Product } from './mercadolivre/productFetcher';

export type PipelineStep = 'link_parse' | 'product_fetch' | 'affiliate_link' | 'shopify_publish';

export class PipelineError extends Error {
  step: PipelineStep;
  code?: string;

  constructor(step: PipelineStep, message: string, code?: string) {
    super(message);
    this.name = 'PipelineError';
    this.step = step;
    this.code = code;
  }
}

export class SessionExpiredError extends Error {
  constructor() {
    super('SESSION_EXPIRED');
    this.name = 'SessionExpiredError';
  }
}

export interface PipelineResult {
  postUrl: string;
}

export interface PipelineDeps {
  parseItemId: (link: string) => string | null;
  fetchProduct: (itemId: string) => Promise<Product>;
  generateAffiliateLink: (productLink: string) => Promise<string>;
  buildPostText: (product: Product, affiliateLink: string) => string;
  publishArticle: (title: string, body: string, imageUrl: string) => Promise<{ url: string }>;
}

export async function runPipeline(link: string, deps: PipelineDeps): Promise<PipelineResult> {
  const itemId = deps.parseItemId(link);
  if (!itemId) {
    throw new PipelineError('link_parse', 'Link inválido: não é um link de produto do Mercado Livre');
  }

  let product: Product;
  try {
    product = await deps.fetchProduct(itemId);
  } catch (err) {
    throw new PipelineError('product_fetch', (err as Error).message);
  }

  let affiliateLink: string;
  try {
    affiliateLink = await deps.generateAffiliateLink(link);
  } catch (err) {
    if (err instanceof SessionExpiredError) {
      throw new PipelineError('affiliate_link', err.message, 'SESSION_EXPIRED');
    }
    throw new PipelineError('affiliate_link', (err as Error).message);
  }

  const body = deps.buildPostText(product, affiliateLink);

  let published: { url: string };
  try {
    published = await deps.publishArticle(product.title, body, product.imageUrl);
  } catch (err) {
    throw new PipelineError('shopify_publish', (err as Error).message);
  }

  return { postUrl: published.url };
}
```

- [ ] **Step 4: Rodar o teste e confirmar que passa**

Run: `npx vitest run src/lib/pipeline.test.ts`
Expected: PASS (5 testes).

- [ ] **Step 5: Commit**

```bash
git add src/lib/pipeline.ts src/lib/pipeline.test.ts
git commit -m "feat: orquestrar pipeline com erro tipado por passo"
```

---

### Task 7: Affiliate Link Generator (Vercel Sandbox + Playwright)

**Files:**
- Create: `src/lib/mercadolivre/affiliateLink.ts`
- Create: `src/lib/mercadolivre/generate-link.playwright.mjs`
- Test: `src/lib/mercadolivre/affiliateLink.test.ts`

**Interfaces:**
- Consumes: `loadSession` de `src/lib/session/sessionStore.ts`; `SessionExpiredError` de `src/lib/pipeline.ts`; `Sandbox` de `@vercel/sandbox`.
- Produces: `async function generateAffiliateLink(productLink: string): Promise<string>`, exportada de `src/lib/mercadolivre/affiliateLink.ts` — mesma assinatura usada em `PipelineDeps.generateAffiliateLink` (Task 6).

**Nota importante:** `generate-link.playwright.mjs` roda dentro da Vercel Sandbox contra o painel real de afiliados do Mercado Livre. Os 3 seletores marcados `AJUSTAR` no script foram escritos sem acesso ao HTML real da página logada (exige sessão) — são o melhor palpite, não um valor confirmado. Antes do primeiro uso real (Task 10), é obrigatório abrir o painel logado manualmente, inspecionar os elementos e corrigir esses 3 seletores. Por isso este arquivo não tem teste automatizado — só `affiliateLink.ts` (a orquestração) é testável por unidade; o script em si é validado manualmente no runbook (Task 10).

- [ ] **Step 1: Escrever o teste que falha primeiro**

Create `src/lib/mercadolivre/affiliateLink.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from 'vitest';

const runCommandMock = vi.fn();
const writeFilesMock = vi.fn();
const downloadFileMock = vi.fn().mockResolvedValue('/tmp/affiliate-failure-123.png');
const getOrCreateMock = vi.fn().mockResolvedValue({
  writeFiles: writeFilesMock,
  runCommand: runCommandMock,
  downloadFile: downloadFileMock,
});

vi.mock('@vercel/sandbox', () => ({
  Sandbox: { getOrCreate: getOrCreateMock },
}));

vi.mock('../session/sessionStore', () => ({
  loadSession: vi.fn().mockResolvedValue(Buffer.from('{"cookies":[]}')),
}));

import { generateAffiliateLink } from './affiliateLink';

describe('generateAffiliateLink', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('retorna o link de afiliado quando o script termina com sucesso', async () => {
    runCommandMock.mockResolvedValue({
      exitCode: 0,
      stdout: async () => 'https://mercadolivre.com/sec/abc123\n',
      stderr: async () => '',
    });

    const link = await generateAffiliateLink('https://mercadolivre.com.br/MLB123');

    expect(link).toBe('https://mercadolivre.com/sec/abc123');
    expect(writeFilesMock).toHaveBeenCalled();
    expect(runCommandMock).toHaveBeenCalledWith(
      expect.objectContaining({
        cmd: 'node',
        args: ['generate-link.mjs', 'https://mercadolivre.com.br/MLB123'],
      }),
    );
  });

  it('lança SessionExpiredError quando o script reporta SESSION_EXPIRED no stderr', async () => {
    runCommandMock.mockResolvedValue({
      exitCode: 1,
      stdout: async () => '',
      stderr: async () => 'SESSION_EXPIRED',
    });

    await expect(generateAffiliateLink('https://mercadolivre.com.br/MLB123')).rejects.toThrow(
      'SESSION_EXPIRED',
    );
  });

  it('lança erro genérico e baixa screenshot quando o script falha por outro motivo', async () => {
    runCommandMock.mockResolvedValue({
      exitCode: 1,
      stdout: async () => '',
      stderr: async () => 'TimeoutError: locator not found',
    });

    await expect(generateAffiliateLink('https://mercadolivre.com.br/MLB123')).rejects.toThrow(
      'Falha ao gerar link de afiliado',
    );
    expect(downloadFileMock).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

Run: `npx vitest run src/lib/mercadolivre/affiliateLink.test.ts`
Expected: FAIL — `Cannot find module './affiliateLink'`.

- [ ] **Step 3: Implementar `generateAffiliateLink`**

Create `src/lib/mercadolivre/affiliateLink.ts`:

```ts
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Sandbox } from '@vercel/sandbox';
import ms from 'ms';
import { SessionExpiredError } from '../pipeline';
import { loadSession } from '../session/sessionStore';

const SANDBOX_NAME = 'promopost-ml-affiliate';
const SCRIPT_PATH = fileURLToPath(new URL('./generate-link.playwright.mjs', import.meta.url));

async function getSandbox() {
  return Sandbox.getOrCreate({
    name: SANDBOX_NAME,
    runtime: 'node24',
    timeout: ms('2m'),
    onCreate: async (sbx) => {
      await sbx.runCommand({ cmd: 'npm', args: ['install', 'playwright'], cwd: '/vercel/sandbox' });
      await sbx.runCommand({
        cmd: 'npx',
        args: ['playwright', 'install', '--with-deps', 'chromium'],
        cwd: '/vercel/sandbox',
      });
    },
  });
}

export async function generateAffiliateLink(productLink: string): Promise<string> {
  const sessionBuffer = await loadSession();
  const scriptContent = readFileSync(SCRIPT_PATH);

  const sandbox = await getSandbox();

  await sandbox.writeFiles([
    { path: '/vercel/sandbox/session.json', content: sessionBuffer },
    { path: '/vercel/sandbox/generate-link.mjs', content: scriptContent },
  ]);

  const result = await sandbox.runCommand({
    cmd: 'node',
    args: ['generate-link.mjs', productLink],
    cwd: '/vercel/sandbox',
  });

  if (result.exitCode !== 0) {
    const stderr = await result.stderr();
    if (stderr.includes('SESSION_EXPIRED')) {
      throw new SessionExpiredError();
    }
    const screenshotPath = await sandbox
      .downloadFile(
        { path: '/vercel/sandbox/failure.png' },
        { path: `/tmp/affiliate-failure-${Date.now()}.png` },
      )
      .catch(() => null);
    const screenshotNote = screenshotPath ? ` (screenshot salvo em ${screenshotPath})` : '';
    throw new Error(`Falha ao gerar link de afiliado: ${stderr.slice(0, 500)}${screenshotNote}`);
  }

  const stdout = (await result.stdout()).trim();
  if (!stdout.startsWith('http')) {
    throw new Error(`Saída inesperada do script de afiliado: ${stdout.slice(0, 200)}`);
  }

  return stdout;
}
```

- [ ] **Step 4: Rodar o teste e confirmar que passa**

Run: `npx vitest run src/lib/mercadolivre/affiliateLink.test.ts`
Expected: PASS (3 testes).

- [ ] **Step 5: Criar o script que roda dentro da sandbox**

Create `src/lib/mercadolivre/generate-link.playwright.mjs`:

```js
// Roda DENTRO da Vercel Sandbox (node generate-link.mjs <link-produto>).
// Usa a sessão salva em /vercel/sandbox/session.json (storageState do Playwright).
//
// ATENÇÃO: os 3 seletores marcados "AJUSTAR" abaixo foram escritos sem acesso
// ao HTML real do painel de afiliados (exige login). Antes do primeiro uso em
// produção, abra o painel logado, inspecione os elementos reais e corrija os
// seletores (ver docs/runbook.md).

import { readFileSync } from 'node:fs';
import { chromium } from 'playwright';

const [, , productLink] = process.argv;

if (!productLink) {
  console.error('Uso: node generate-link.mjs <link-produto>');
  process.exit(1);
}

const storageState = JSON.parse(readFileSync('/vercel/sandbox/session.json', 'utf8'));

const browser = await chromium.launch();
const context = await browser.newContext({ storageState });
const page = await context.newPage();

try {
  await page.goto('https://www.mercadolivre.com.br/afiliados/linkbuilder', {
    waitUntil: 'domcontentloaded',
  });

  const loggedOut = await page
    .locator('text=Iniciar sessão')
    .first()
    .isVisible()
    .catch(() => false);

  if (loggedOut) {
    console.error('SESSION_EXPIRED');
    process.exit(1);
  }

  // AJUSTAR: placeholder do campo de input do link, confirmar no painel real.
  await page.getByPlaceholder('Cole o link do produto').fill(productLink);

  // AJUSTAR: texto do botão de gerar link, confirmar no painel real.
  await page.getByRole('button', { name: 'Gerar link' }).click();

  // AJUSTAR: seletor do elemento que mostra o link gerado, confirmar no painel real.
  const generatedLink = await page
    .locator('[data-testid="generated-affiliate-link"]')
    .innerText({ timeout: 15000 });

  console.log(generatedLink.trim());
} catch (err) {
  await page.screenshot({ path: '/vercel/sandbox/failure.png' }).catch(() => {});
  console.error(String(err));
  process.exit(1);
} finally {
  await browser.close();
}
```

- [ ] **Step 6: Commit**

```bash
git add src/lib/mercadolivre/affiliateLink.ts src/lib/mercadolivre/affiliateLink.test.ts src/lib/mercadolivre/generate-link.playwright.mjs
git commit -m "feat: gerar link de afiliado ML via Vercel Sandbox + Playwright"
```

---

### Task 8: Webhook route handler

**Files:**
- Create: `src/app/api/webhook/route.ts`
- Test: `src/app/api/webhook/route.test.ts`

**Interfaces:**
- Consumes: `runPipeline`, `PipelineError`, `SessionExpiredError` de `src/lib/pipeline.ts`; `parseItemId` de `src/lib/mercadolivre/parseLink.ts`; `fetchProduct` de `src/lib/mercadolivre/productFetcher.ts`; `generateAffiliateLink` de `src/lib/mercadolivre/affiliateLink.ts`; `buildPostText` de `src/lib/content/template.ts`; `publishArticle` de `src/lib/shopify/publisher.ts`.
- Produces: handler `POST(request: Request): Promise<Response>` no App Router.

- [ ] **Step 1: Escrever o teste que falha primeiro**

Create `src/app/api/webhook/route.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/mercadolivre/parseLink', () => ({ parseItemId: vi.fn() }));
vi.mock('@/lib/mercadolivre/productFetcher', () => ({ fetchProduct: vi.fn() }));
vi.mock('@/lib/mercadolivre/affiliateLink', () => ({ generateAffiliateLink: vi.fn() }));
vi.mock('@/lib/content/template', () => ({ buildPostText: vi.fn() }));
vi.mock('@/lib/shopify/publisher', () => ({ publishArticle: vi.fn() }));

import { buildPostText } from '@/lib/content/template';
import { generateAffiliateLink } from '@/lib/mercadolivre/affiliateLink';
import { parseItemId } from '@/lib/mercadolivre/parseLink';
import { fetchProduct } from '@/lib/mercadolivre/productFetcher';
import { SessionExpiredError } from '@/lib/pipeline';
import { publishArticle } from '@/lib/shopify/publisher';
import { POST } from './route';

function makeRequest(body: unknown, secret = 'correct-secret') {
  return new Request('https://promopost.example.com/api/webhook', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-promopost-secret': secret },
    body: JSON.stringify(body),
  });
}

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

  it('retorna 200 com a url do post no caminho feliz', async () => {
    vi.stubEnv('WEBHOOK_SECRET', 'correct-secret');
    vi.mocked(parseItemId).mockReturnValue('MLB123');
    vi.mocked(fetchProduct).mockResolvedValue({
      title: 'Produto X',
      price: 99.9,
      imageUrl: 'https://x.com/img.jpg',
    });
    vi.mocked(generateAffiliateLink).mockResolvedValue('https://mercadolivre.com/sec/abc');
    vi.mocked(buildPostText).mockReturnValue('texto do post');
    vi.mocked(publishArticle).mockResolvedValue({
      url: 'https://loja.myshopify.com/blogs/noticias/produto-x',
    });

    const response = await POST(makeRequest({ link: 'https://mercadolivre.com.br/MLB123' }));
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json).toEqual({ postUrl: 'https://loja.myshopify.com/blogs/noticias/produto-x' });
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
    vi.mocked(fetchProduct).mockResolvedValue({
      title: 'Produto X',
      price: 99.9,
      imageUrl: 'https://x.com/img.jpg',
    });
    vi.mocked(generateAffiliateLink).mockRejectedValue(new SessionExpiredError());

    const response = await POST(makeRequest({ link: 'https://mercadolivre.com.br/MLB123' }));
    const json = await response.json();

    expect(response.status).toBe(502);
    expect(json).toEqual({ passo: 'affiliate_link', erro: 'SESSION_EXPIRED' });
  });
});
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

Run: `npx vitest run src/app/api/webhook/route.test.ts`
Expected: FAIL — `Cannot find module './route'`.

- [ ] **Step 3: Implementar a rota**

Create `src/app/api/webhook/route.ts`:

```ts
import { buildPostText } from '@/lib/content/template';
import { generateAffiliateLink } from '@/lib/mercadolivre/affiliateLink';
import { parseItemId } from '@/lib/mercadolivre/parseLink';
import { fetchProduct } from '@/lib/mercadolivre/productFetcher';
import { PipelineError, runPipeline } from '@/lib/pipeline';
import { publishArticle } from '@/lib/shopify/publisher';

export const maxDuration = 300;

export async function POST(request: Request): Promise<Response> {
  const secret = request.headers.get('x-promopost-secret');
  if (!secret || secret !== process.env.WEBHOOK_SECRET) {
    return Response.json({ erro: 'unauthorized' }, { status: 401 });
  }

  let body: { link?: string };
  try {
    body = await request.json();
  } catch {
    return Response.json({ erro: 'invalid_json' }, { status: 400 });
  }

  if (!body.link) {
    return Response.json({ erro: 'missing_link' }, { status: 400 });
  }

  try {
    const result = await runPipeline(body.link, {
      parseItemId,
      fetchProduct,
      generateAffiliateLink,
      buildPostText,
      publishArticle,
    });
    return Response.json({ postUrl: result.postUrl }, { status: 200 });
  } catch (err) {
    if (err instanceof PipelineError) {
      const status = err.step === 'link_parse' ? 400 : 502;
      return Response.json({ passo: err.step, erro: err.code ?? err.message }, { status });
    }
    return Response.json({ erro: 'internal_error' }, { status: 500 });
  }
}
```

- [ ] **Step 4: Rodar o teste e confirmar que passa**

Run: `npx vitest run src/app/api/webhook/route.test.ts`
Expected: PASS (4 testes).

- [ ] **Step 5: Rodar a suíte inteira e o typecheck**

Run: `npm test && npm run typecheck`
Expected: todos os testes de todas as tasks anteriores PASS; typecheck sem erro.

- [ ] **Step 6: Commit**

```bash
git add src/app/api/webhook/route.ts src/app/api/webhook/route.test.ts
git commit -m "feat: expor pipeline no endpoint POST /api/webhook"
```

---

### Task 9: Bootstrap da sessão Mercado Livre (script manual local)

**Files:**
- Create: `scripts/bootstrap-session.mjs`

**Interfaces:**
- Consumes: `put` de `@vercel/blob` (chamada direta, não reaproveita `sessionStore.ts` porque este script roda fora do build TypeScript do projeto — ver nota abaixo).
- Produces: nenhuma exportação — é um script standalone executado manualmente pelo usuário.

**Por que sem teste automatizado:** este passo abre um Chromium visível para um humano logar de verdade no Mercado Livre — não há o que testar por unidade. É validado executando de verdade (Step 2 abaixo) e novamente na Task 10.

- [ ] **Step 1: Criar o script**

Create `scripts/bootstrap-session.mjs`:

```js
#!/usr/bin/env node
// Rodar localmente UMA VEZ (ou sempre que a sessão do Mercado Livre expirar):
//   BLOB_READ_WRITE_TOKEN=xxx node scripts/bootstrap-session.mjs
//
// Abre um Chromium visível: logue manualmente no Mercado Livre e navegue até
// o painel de afiliados. Volte ao terminal e aperte ENTER — o script salva a
// sessão (cookies) no Vercel Blob e imprime a URL que vai na env var
// ML_SESSION_BLOB_URL do projeto na Vercel.

import readline from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { put } from '@vercel/blob';
import { chromium } from 'playwright';

async function main() {
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    console.error('Defina BLOB_READ_WRITE_TOKEN antes de rodar este script.');
    process.exit(1);
  }

  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();

  await page.goto('https://www.mercadolivre.com.br/afiliados/linkbuilder');

  const rl = readline.createInterface({ input: stdin, output: stdout });
  await rl.question(
    '\nLogue no Mercado Livre na janela aberta e navegue até o painel de afiliados.\n' +
      'Quando terminar, volte aqui e aperte ENTER para salvar a sessão...',
  );
  rl.close();

  const storageState = await context.storageState();
  const buffer = Buffer.from(JSON.stringify(storageState));

  const blob = await put('ml-session.json', buffer, {
    access: 'private',
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: 'application/json',
    token: process.env.BLOB_READ_WRITE_TOKEN,
  });

  console.log('\nSessão salva.');
  console.log('Configure na Vercel: ML_SESSION_BLOB_URL =', blob.url);

  await browser.close();
}

main();
```

- [ ] **Step 2: Validação manual**

Run: `BLOB_READ_WRITE_TOKEN=<token real do Vercel Blob> node scripts/bootstrap-session.mjs`
Expected: abre uma janela do Chromium; após logar manualmente e apertar ENTER, o terminal imprime `Sessão salva.` seguido de uma URL `https://blob.vercel-storage.com/...`.

Depois, configure `ML_SESSION_BLOB_URL` com essa URL nas variáveis de ambiente do projeto na Vercel (dashboard ou `vercel env add`).

- [ ] **Step 3: Commit**

```bash
git add scripts/bootstrap-session.mjs
git commit -m "feat: script de bootstrap manual da sessao Mercado Livre"
```

---

### Task 10: Runbook de validação ponta-a-ponta

**Files:**
- Create: `docs/runbook.md`

**Interfaces:** nenhuma — documento operacional, sem código de produção.

- [ ] **Step 1: Criar o runbook**

Create `docs/runbook.md`:

```markdown
# PromoPost MVP — Runbook de validação

Checklist pra validar o fluxo completo depois de implementar todas as tasks do plano.

## 1. Configurar variáveis de ambiente na Vercel

- `WEBHOOK_SECRET` — qualquer string aleatória longa.
- `BLOB_READ_WRITE_TOKEN` — criar um Blob Store no dashboard Vercel (Storage > Blob) e copiar o token.
- `SHOPIFY_SHOP_DOMAIN` — ex: `sua-loja.myshopify.com`.
- `SHOPIFY_ADMIN_ACCESS_TOKEN` — criar um app customizado no admin Shopify com escopo `write_content`.
- `SHOPIFY_BLOG_ID` — GID do blog de destino (`gid://shopify/Blog/<id>`); pegue o `<id>` numérico na URL do blog no admin Shopify.
- `ML_SESSION_BLOB_URL` — preenchido no passo 2 abaixo.

## 2. Bootstrap da sessão Mercado Livre

Rodar localmente (ver Task 9):

```bash
BLOB_READ_WRITE_TOKEN=<token> node scripts/bootstrap-session.mjs
```

Logar manualmente, confirmar, copiar a URL impressa pra `ML_SESSION_BLOB_URL` na Vercel.

## 3. Ajustar os seletores do Playwright contra o site real

Abrir `https://www.mercadolivre.com.br/afiliados/linkbuilder` já logado (mesma sessão do passo 2) e, com o DevTools, confirmar/corrigir os 3 seletores marcados `AJUSTAR` em `src/lib/mercadolivre/generate-link.playwright.mjs` (Task 7):

- placeholder do campo de link,
- texto do botão de gerar link,
- seletor do elemento que mostra o link gerado.

## 4. Rodar a suíte de testes local

```bash
npm test
npm run typecheck
```

Esperado: tudo verde.

## 5. Deploy

```bash
vercel deploy --prod
```

## 6. Teste ponta-a-ponta real

```bash
curl -X POST https://<seu-dominio>.vercel.app/api/webhook \
  -H "content-type: application/json" \
  -H "x-promopost-secret: $WEBHOOK_SECRET" \
  -d '{"link":"https://produto.mercadolivre.com.br/MLB-1234567890-produto-exemplo-_JM"}'
```

Use um link de produto real do Mercado Livre. Esperado: resposta `200` com `{ "postUrl": "..." }`.

## 7. Conferir o resultado

- Abrir a `postUrl` retornada — deve ser um artigo em **rascunho** no blog Shopify, com o texto no formato `[TÍTULO] por R$[PREÇO] — confira: [LINK_AFILIADO]` e a imagem do produto.
- Conferir no painel de afiliados do Mercado Livre que o link gerado (`/sec/...`) corresponde ao produto certo.
- Publicar o artigo manualmente no admin Shopify se o resultado estiver correto.

## 8. Se algo falhar

A resposta de erro do webhook traz `{ "passo": "...", "erro": "..." }` indicando em qual dos 4 passos parou:

- `link_parse` — o link enviado não é reconhecido como produto Mercado Livre.
- `product_fetch` — a API pública do Mercado Livre falhou ou o item não existe.
- `affiliate_link` — a automação Playwright falhou. Se `erro` for `SESSION_EXPIRED`, repita o passo 2 (bootstrap). Caso contrário, o erro inclui o caminho de um screenshot de falha (salvo em `/tmp` na função Vercel — baixe os logs da execução para inspecionar).
- `shopify_publish` — a API do Shopify recusou a criação do artigo (token inválido, blog errado, rate limit).
```

- [ ] **Step 2: Commit**

```bash
git add docs/runbook.md
git commit -m "docs: runbook de validacao ponta a ponta do MVP"
```

---

## Self-Review

**Cobertura do spec:** webhook + secret (Task 8), Product Fetcher (Task 2), Affiliate Link Generator + SESSION_EXPIRED + screenshot de falha (Task 7), Content Templater (Task 3), Shopify Publisher em rascunho (Task 5), Session Store + bootstrap manual (Task 4, 9), erro por passo com status HTTP correto (Task 6, 8), sem retry automático (nenhuma task implementa retry), testagem unitária de tudo exceto a automação de browser real (coberto em todas as tasks), validação ponta-a-ponta manual (Task 10). Sem lacunas identificadas.

**Placeholder scan:** nenhum "TBD"/"TODO" solto. As 3 marcações `AJUSTAR` no script Playwright são uma limitação real e documentada (dependem de inspecionar HTML atrás de login), não uma instrução vaga — vêm com código completo e um passo explícito de correção no runbook (Task 10, Step 3).

**Consistência de tipos:** `Product` (Task 2) usado igual em `template.ts` (Task 3), `pipeline.ts` (Task 6) e nos testes de `affiliateLink`/`route`. `generateAffiliateLink(productLink: string): Promise<string>` consistente entre `PipelineDeps` (Task 6) e a implementação real (Task 7). `publishArticle(title, body, imageUrl)` consistente entre `PipelineDeps`, `publisher.ts` (Task 5) e a chamada em `runPipeline`. `SessionExpiredError` definida uma vez em `pipeline.ts` (Task 6) e reaproveitada em `affiliateLink.ts` (Task 7) e nos testes de `route.ts` (Task 8) — sem duplicação nem divergência de nome.
