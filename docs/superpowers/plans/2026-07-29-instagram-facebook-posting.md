# Instagram e Facebook Posting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Depois que `/api/webhook` publica o post no blog Shopify, postar automaticamente a mesma promoção no Facebook (Página) e no Instagram (conta comercial conectada), como passos *best-effort* que não afetam o resultado do blog se falharem.

**Architecture:** Dois publishers novos (`facebook.ts`, `instagram.ts`) que fazem chamadas diretas à Graph API da Meta, mais um caption builder (`caption.ts`) que espelha `buildPostText` em texto puro com hashtags. `route.ts` do webhook chama os dois publishers depois do Shopify publicar com sucesso, cada um em try/catch isolado, e inclui o resultado de cada rede na resposta JSON.

**Tech Stack:** Graph API da Meta (`graph.facebook.com`, versão `v26.0`, confirmada como a versão estável atual em 2026-07-29), `fetch` nativo (mesmo padrão de `publisher.ts`), TypeScript, Vitest.

## Global Constraints

- Node >=24, TypeScript estrito (mesmas configs já existentes no projeto).
- Todo texto voltado ao usuário/operador (mensagens de erro, comentários no runbook) em português.
- Postar no Facebook/Instagram é *best-effort*: uma falha em qualquer um dos dois não pode impedir a resposta de sucesso do blog nem derrubar o outro. Sem retentativa automática (mesma filosofia do resto do projeto).
- `pipeline.ts` e o fluxo Mercado Livre → Shopify **não são modificados** — a integração social vive inteiramente em `route.ts` e nos novos arquivos de `src/lib/social/`.
- As legendas de Instagram/Facebook são texto puro (sem HTML) — diferente de `buildPostText`, que gera HTML pro Shopify.

---

### Task 1: Social Caption Builder

**Files:**
- Create: `src/lib/social/caption.ts`
- Test: `src/lib/social/caption.test.ts`

**Interfaces:**
- Consumes: `Product` de `src/lib/mercadolivre/affiliateLink.ts` (`{ title: string; price: number; imageUrl: string }`).
- Produces: `buildSocialCaption(product: Product, affiliateLink: string, coupon?: string, discountedPrice?: number): string` — usada pela Task 4.

- [ ] **Step 1: Escrever os testes que falham**

Criar `src/lib/social/caption.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import { buildSocialCaption } from './caption';

describe('buildSocialCaption', () => {
  it('monta a legenda com preço único e hashtags, sem HTML', () => {
    const text = buildSocialCaption(
      { title: 'Fone de Ouvido Bluetooth XYZ', price: 149.9, imageUrl: 'https://x.com/img.jpg' },
      'https://meli.la/abc123',
    );
    expect(text).toBe(
      '🏷️ R$149,90\n\n🔗 Confira: https://meli.la/abc123\n\n#promocao #oferta #mercadolivre #desconto',
    );
  });

  it('monta a legenda com preço de/por e cupom quando discountedPrice é informado', () => {
    const text = buildSocialCaption(
      { title: 'Fone de Ouvido Bluetooth XYZ', price: 149.9, imageUrl: 'https://x.com/img.jpg' },
      'https://meli.la/abc123',
      'PROMO10',
      89.9,
    );
    expect(text).toBe(
      '🔥 De R$149,90 por R$89,90\n\n🎟️ Cupom: PROMO10\n\n🔗 Confira: https://meli.la/abc123\n\n#promocao #oferta #mercadolivre #desconto',
    );
  });

  it('monta preço de/por sem cupom quando discountedPrice vem sem coupon', () => {
    const text = buildSocialCaption(
      { title: 'Produto X', price: 200, imageUrl: 'https://x.com/img.jpg' },
      'https://meli.la/xyz',
      undefined,
      150,
    );
    expect(text).toBe(
      '🔥 De R$200,00 por R$150,00\n\n🔗 Confira: https://meli.la/xyz\n\n#promocao #oferta #mercadolivre #desconto',
    );
  });

  it('cai no caminho de preço único quando discountedPrice não é um número (defesa contra caller malformado)', () => {
    const text = buildSocialCaption(
      { title: 'Produto X', price: 200, imageUrl: 'https://x.com/img.jpg' },
      'https://meli.la/xyz',
      undefined,
      null as unknown as number | undefined,
    );
    expect(text).toBe(
      '🏷️ R$200,00\n\n🔗 Confira: https://meli.la/xyz\n\n#promocao #oferta #mercadolivre #desconto',
    );
  });
});
```

- [ ] **Step 2: Rodar os testes e confirmar que falham**

Run: `npm test -- caption.test.ts`
Expected: FAIL — `Cannot find module './caption'`

- [ ] **Step 3: Implementar `buildSocialCaption`**

Criar `src/lib/social/caption.ts`:

```typescript
import type { Product } from '../mercadolivre/affiliateLink';

const HASHTAGS = '#promocao #oferta #mercadolivre #desconto';

function formatPrice(value: number): string {
  return value.toLocaleString('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function buildSocialCaption(
  product: Product,
  affiliateLink: string,
  coupon?: string,
  discountedPrice?: number,
): string {
  const linkLine = `🔗 Confira: ${affiliateLink}`;

  if (typeof discountedPrice === 'number') {
    const regularPrice = formatPrice(product.price);
    const discounted = formatPrice(discountedPrice);
    const priceLine = `🔥 De R$${regularPrice} por R$${discounted}`;
    const couponLine = coupon ? `\n\n🎟️ Cupom: ${coupon}` : '';
    return `${priceLine}${couponLine}\n\n${linkLine}\n\n${HASHTAGS}`;
  }

  const price = formatPrice(product.price);
  return `🏷️ R$${price}\n\n${linkLine}\n\n${HASHTAGS}`;
}
```

- [ ] **Step 4: Rodar os testes e confirmar que passam**

Run: `npm test -- caption.test.ts`
Expected: PASS (4 testes)

- [ ] **Step 5: Commit**

```bash
git add src/lib/social/caption.ts src/lib/social/caption.test.ts
git commit -m "feat: legenda de post social (Instagram/Facebook) em texto puro com hashtags"
```

---

### Task 2: Facebook Publisher

**Files:**
- Create: `src/lib/social/facebook.ts`
- Test: `src/lib/social/facebook.test.ts`

**Interfaces:**
- Consumes: nenhuma dependência de tasks anteriores (recebe `imageUrl`/`caption` já prontos como string).
- Produces: `SocialPostResult` (`{ postId: string }`) e `postToFacebook(imageUrl: string, caption: string): Promise<SocialPostResult>` — usados pela Task 4. `SocialPostResult` é reexportado e reaproveitado pela Task 3 (Instagram).
- Variáveis de ambiente: `META_PAGE_ID`, `META_SYSTEM_USER_TOKEN`.

- [ ] **Step 1: Escrever os testes que falham**

Criar `src/lib/social/facebook.test.ts`:

```typescript
import { afterEach, describe, expect, it, vi } from 'vitest';
import { postToFacebook } from './facebook';

function stubEnv() {
  vi.stubEnv('META_PAGE_ID', '123456789');
  vi.stubEnv('META_SYSTEM_USER_TOKEN', 'fake-token');
}

describe('postToFacebook', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('posta a foto na Página e retorna o postId', async () => {
    stubEnv();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: 'photo_1', post_id: '123456789_999' }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await postToFacebook('https://x.com/img.jpg', 'legenda do post');

    expect(result).toEqual({ postId: '123456789_999' });
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe('https://graph.facebook.com/v26.0/123456789/photos');
    const parsedBody = JSON.parse(options.body);
    expect(parsedBody).toEqual({
      url: 'https://x.com/img.jpg',
      caption: 'legenda do post',
      access_token: 'fake-token',
    });
  });

  it('lança erro quando a API retorna erro', async () => {
    stubEnv();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        json: async () => ({ error: { message: 'Token inválido' } }),
      }),
    );

    await expect(postToFacebook('https://x.com/img.jpg', 'legenda')).rejects.toThrow(
      'Falha ao postar no Facebook: Token inválido',
    );
  });

  it('lança erro quando faltam variáveis de ambiente', async () => {
    await expect(postToFacebook('https://x.com/img.jpg', 'legenda')).rejects.toThrow(
      'Variáveis de ambiente da Meta ausentes',
    );
  });
});
```

- [ ] **Step 2: Rodar os testes e confirmar que falham**

Run: `npm test -- facebook.test.ts`
Expected: FAIL — `Cannot find module './facebook'`

- [ ] **Step 3: Implementar `postToFacebook`**

Criar `src/lib/social/facebook.ts`:

```typescript
export interface SocialPostResult {
  postId: string;
}

interface FacebookConfig {
  pageId: string;
  accessToken: string;
}

function getConfig(): FacebookConfig {
  const pageId = process.env.META_PAGE_ID;
  const accessToken = process.env.META_SYSTEM_USER_TOKEN;
  if (!pageId || !accessToken) {
    throw new Error('Variáveis de ambiente da Meta ausentes: META_PAGE_ID, META_SYSTEM_USER_TOKEN');
  }
  return { pageId, accessToken };
}

export async function postToFacebook(imageUrl: string, caption: string): Promise<SocialPostResult> {
  const config = getConfig();

  const res = await fetch(`https://graph.facebook.com/v26.0/${config.pageId}/photos`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      url: imageUrl,
      caption,
      access_token: config.accessToken,
    }),
  });

  const json = await res.json();
  if (!res.ok || json.error) {
    throw new Error(`Falha ao postar no Facebook: ${json.error?.message ?? res.status}`);
  }

  return { postId: json.post_id ?? json.id };
}
```

- [ ] **Step 4: Rodar os testes e confirmar que passam**

Run: `npm test -- facebook.test.ts`
Expected: PASS (3 testes)

- [ ] **Step 5: Commit**

```bash
git add src/lib/social/facebook.ts src/lib/social/facebook.test.ts
git commit -m "feat: postar foto na Página do Facebook via Graph API"
```

---

### Task 3: Instagram Publisher

**Files:**
- Create: `src/lib/social/instagram.ts`
- Test: `src/lib/social/instagram.test.ts`

**Interfaces:**
- Consumes: `SocialPostResult` de `src/lib/social/facebook.ts` (Task 2) — `{ postId: string }`.
- Produces: `postToInstagram(imageUrl: string, caption: string): Promise<SocialPostResult>` — usado pela Task 4.
- Variáveis de ambiente: `META_IG_BUSINESS_ACCOUNT_ID`, `META_SYSTEM_USER_TOKEN`.

- [ ] **Step 1: Escrever os testes que falham**

Criar `src/lib/social/instagram.test.ts`:

```typescript
import { afterEach, describe, expect, it, vi } from 'vitest';
import { postToInstagram } from './instagram';

function stubEnv() {
  vi.stubEnv('META_IG_BUSINESS_ACCOUNT_ID', '17841400000000000');
  vi.stubEnv('META_SYSTEM_USER_TOKEN', 'fake-token');
}

describe('postToInstagram', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('cria o container de mídia e depois publica, retornando o postId', async () => {
    stubEnv();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ id: 'container_1' }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ id: 'media_999' }) });
    vi.stubGlobal('fetch', fetchMock);

    const result = await postToInstagram('https://x.com/img.jpg', 'legenda do post');

    expect(result).toEqual({ postId: 'media_999' });
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const [createUrl, createOptions] = fetchMock.mock.calls[0];
    expect(createUrl).toBe('https://graph.facebook.com/v26.0/17841400000000000/media');
    expect(JSON.parse(createOptions.body)).toEqual({
      image_url: 'https://x.com/img.jpg',
      caption: 'legenda do post',
      access_token: 'fake-token',
    });

    const [publishUrl, publishOptions] = fetchMock.mock.calls[1];
    expect(publishUrl).toBe('https://graph.facebook.com/v26.0/17841400000000000/media_publish');
    expect(JSON.parse(publishOptions.body)).toEqual({
      creation_id: 'container_1',
      access_token: 'fake-token',
    });
  });

  it('lança erro quando a criação do container falha', async () => {
    stubEnv();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        json: async () => ({ error: { message: 'Imagem inválida' } }),
      }),
    );

    await expect(postToInstagram('https://x.com/img.jpg', 'legenda')).rejects.toThrow(
      'Falha ao criar mídia do Instagram: Imagem inválida',
    );
  });

  it('lança erro quando a publicação do container falha', async () => {
    stubEnv();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ id: 'container_1' }) })
      .mockResolvedValueOnce({
        ok: false,
        json: async () => ({ error: { message: 'Container expirado' } }),
      });
    vi.stubGlobal('fetch', fetchMock);

    await expect(postToInstagram('https://x.com/img.jpg', 'legenda')).rejects.toThrow(
      'Falha ao publicar mídia do Instagram: Container expirado',
    );
  });

  it('lança erro quando faltam variáveis de ambiente', async () => {
    await expect(postToInstagram('https://x.com/img.jpg', 'legenda')).rejects.toThrow(
      'Variáveis de ambiente da Meta ausentes',
    );
  });
});
```

- [ ] **Step 2: Rodar os testes e confirmar que falham**

Run: `npm test -- instagram.test.ts`
Expected: FAIL — `Cannot find module './instagram'`

- [ ] **Step 3: Implementar `postToInstagram`**

Criar `src/lib/social/instagram.ts`:

```typescript
import type { SocialPostResult } from './facebook';

interface InstagramConfig {
  igUserId: string;
  accessToken: string;
}

function getConfig(): InstagramConfig {
  const igUserId = process.env.META_IG_BUSINESS_ACCOUNT_ID;
  const accessToken = process.env.META_SYSTEM_USER_TOKEN;
  if (!igUserId || !accessToken) {
    throw new Error(
      'Variáveis de ambiente da Meta ausentes: META_IG_BUSINESS_ACCOUNT_ID, META_SYSTEM_USER_TOKEN',
    );
  }
  return { igUserId, accessToken };
}

export async function postToInstagram(imageUrl: string, caption: string): Promise<SocialPostResult> {
  const config = getConfig();

  const createRes = await fetch(`https://graph.facebook.com/v26.0/${config.igUserId}/media`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      image_url: imageUrl,
      caption,
      access_token: config.accessToken,
    }),
  });
  const createJson = await createRes.json();
  if (!createRes.ok || createJson.error || !createJson.id) {
    throw new Error(`Falha ao criar mídia do Instagram: ${createJson.error?.message ?? createRes.status}`);
  }

  const publishRes = await fetch(`https://graph.facebook.com/v26.0/${config.igUserId}/media_publish`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      creation_id: createJson.id,
      access_token: config.accessToken,
    }),
  });
  const publishJson = await publishRes.json();
  if (!publishRes.ok || publishJson.error || !publishJson.id) {
    throw new Error(
      `Falha ao publicar mídia do Instagram: ${publishJson.error?.message ?? publishRes.status}`,
    );
  }

  return { postId: publishJson.id };
}
```

- [ ] **Step 4: Rodar os testes e confirmar que passam**

Run: `npm test -- instagram.test.ts`
Expected: PASS (4 testes)

- [ ] **Step 5: Commit**

```bash
git add src/lib/social/instagram.ts src/lib/social/instagram.test.ts
git commit -m "feat: postar no Instagram via Graph API (container + publish)"
```

---

### Task 4: Integrar no webhook, variáveis de ambiente e runbook

**Files:**
- Modify: `src/app/api/webhook/route.ts`
- Modify: `src/app/api/webhook/route.test.ts`
- Modify: `.env.example`
- Modify: `docs/runbook.md`

**Interfaces:**
- Consumes: `buildSocialCaption` (Task 1), `postToFacebook` (Task 2), `postToInstagram` (Task 3) — todas já testadas isoladamente; esta task só integra.
- Produces: resposta do webhook estendida com os campos `facebook` e `instagram` (ver Step 3).

- [ ] **Step 1: Ler o arquivo atual pra confirmar as linhas exatas**

`src/app/api/webhook/route.ts` hoje termina assim (não precisa reproduzir aqui, só confirmar visualmente antes de editar):

```typescript
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
    return Response.json({ postUrl: result.postUrl }, { status: 200 });
```

- [ ] **Step 2: Escrever o teste que falha**

Adicionar em `src/app/api/webhook/route.test.ts`, junto aos mocks já existentes no topo do arquivo (ao lado de `vi.mock('@/lib/shopify/publisher', ...)`):

```typescript
vi.mock('@/lib/social/caption', () => ({ buildSocialCaption: vi.fn() }));
vi.mock('@/lib/social/facebook', () => ({ postToFacebook: vi.fn() }));
vi.mock('@/lib/social/instagram', () => ({ postToInstagram: vi.fn() }));
```

E nos imports do topo do arquivo, junto aos já existentes:

```typescript
import { buildSocialCaption } from '@/lib/social/caption';
import { postToFacebook } from '@/lib/social/facebook';
import { postToInstagram } from '@/lib/social/instagram';
```

Adicionar estes testes ao final do `describe('POST /api/webhook', ...)`, depois do teste `'retorna 200 com a url do post no caminho feliz'` (reaproveitando o mesmo setup de mocks do pipeline):

```typescript
  it('posta no Facebook e Instagram depois do blog publicar, e inclui os dois na resposta', async () => {
    vi.stubEnv('WEBHOOK_SECRET', 'correct-secret');
    vi.mocked(parseItemId).mockReturnValue('MLB123');
    vi.mocked(fetchProductAndAffiliateLink).mockResolvedValue({
      product: { title: 'Produto X', price: 99.9, imageUrl: 'https://x.com/img.jpg' },
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
    });
    expect(postToFacebook).toHaveBeenCalledWith('https://x.com/img.jpg', 'legenda social');
    expect(postToInstagram).toHaveBeenCalledWith('https://x.com/img.jpg', 'legenda social');
  });

  it('retorna postUrl mesmo quando Facebook e Instagram falham (best-effort, não derruba o blog)', async () => {
    vi.stubEnv('WEBHOOK_SECRET', 'correct-secret');
    vi.mocked(parseItemId).mockReturnValue('MLB123');
    vi.mocked(fetchProductAndAffiliateLink).mockResolvedValue({
      product: { title: 'Produto X', price: 99.9, imageUrl: 'https://x.com/img.jpg' },
      affiliateLink: 'https://meli.la/abc',
    });
    vi.mocked(buildPostText).mockReturnValue('texto do post');
    vi.mocked(publishArticle).mockResolvedValue({
      url: 'https://loja.myshopify.com/blogs/noticias/produto-x',
    });
    vi.mocked(buildSocialCaption).mockReturnValue('legenda social');
    vi.mocked(postToFacebook).mockRejectedValue(new Error('Token inválido'));
    vi.mocked(postToInstagram).mockRejectedValue(new Error('Imagem inválida'));

    const response = await POST(makeRequest({ link: 'https://mercadolivre.com.br/MLB123' }));
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json).toEqual({
      postUrl: 'https://loja.myshopify.com/blogs/noticias/produto-x',
      facebook: { ok: false, error: 'Token inválido' },
      instagram: { ok: false, error: 'Imagem inválida' },
    });
  });
```

- [ ] **Step 3: Rodar os testes e confirmar que falham**

Run: `npm test -- route.test.ts` (dentro de `src/app/api/webhook/`)
Expected: FAIL — os dois novos testes falham porque `route.ts` ainda não chama `buildSocialCaption`/`postToFacebook`/`postToInstagram`, então a resposta não tem os campos `facebook`/`instagram`.

- [ ] **Step 4a: Fazer `runPipeline` devolver `product` e `affiliateLink`**

`postToFacebook`/`postToInstagram` precisam de `product.imageUrl`, e `buildSocialCaption` precisa de `product`/`affiliateLink` inteiros. Em vez de chamar `fetchProductAndAffiliateLink` de novo em `route.ts` (repetiria a geração cara do link de afiliado via Playwright), `runPipeline` passa a devolver esses dados — ele já os calcula internamente.

Em `src/lib/pipeline.ts`, adicionar `Product` aos imports do topo (já existe `import type { Product } from './mercadolivre/affiliateLink';` — confirme antes de duplicar) e mudar a interface `PipelineResult`:

```typescript
export interface PipelineResult {
  postUrl: string;
  product: Product;
  affiliateLink: string;
}
```

E mudar a última linha da função `runPipeline` (hoje `return { postUrl: published.url };`) para:

```typescript
  return { postUrl: published.url, product, affiliateLink };
```

(`product` e `affiliateLink` já são variáveis locais em escopo nesse ponto da função, atribuídas mais acima por `({ product, affiliateLink } = await deps.fetchProductAndAffiliateLink(link));`.)

Em `src/lib/pipeline.test.ts`, no teste `'roda os passos em ordem e retorna a url do post'`, trocar:

```typescript
    expect(result).toEqual({ postUrl: 'https://loja.myshopify.com/blogs/noticias/produto-x' });
```

por:

```typescript
    expect(result).toEqual({
      postUrl: 'https://loja.myshopify.com/blogs/noticias/produto-x',
      product: { title: 'Produto X', price: 99.9, imageUrl: 'https://x.com/img.jpg' },
      affiliateLink: 'https://meli.la/abc',
    });
```

(`{ title: 'Produto X', price: 99.9, imageUrl: 'https://x.com/img.jpg' }` e `'https://meli.la/abc'` são os mesmos valores que `makeDeps()` já configura como retorno de `fetchProductAndAffiliateLink` nesse arquivo — confirme os valores exatos lendo `makeDeps()` no topo do arquivo antes de editar.)

- [ ] **Step 4b: Implementar a integração em `route.ts`**

No topo do arquivo, junto aos imports já existentes, adicionar:

```typescript
import { buildSocialCaption } from '@/lib/social/caption';
import { postToFacebook } from '@/lib/social/facebook';
import { postToInstagram } from '@/lib/social/instagram';
```

Substituir o bloco final do `try` (que hoje só publica no Shopify e retorna `{ postUrl: result.postUrl }`) por:

```typescript
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

    const caption = buildSocialCaption(result.product, result.affiliateLink, body.coupon, body.discountedPrice);

    const [facebook, instagram] = await Promise.all([
      postToFacebook(result.product.imageUrl, caption)
        .then((r) => ({ ok: true as const, postId: r.postId }))
        .catch((err: Error) => {
          console.error('Erro ao postar no Facebook:', err);
          return { ok: false as const, error: err.message };
        }),
      postToInstagram(result.product.imageUrl, caption)
        .then((r) => ({ ok: true as const, postId: r.postId }))
        .catch((err: Error) => {
          console.error('Erro ao postar no Instagram:', err);
          return { ok: false as const, error: err.message };
        }),
    ]);

    return Response.json({ postUrl: result.postUrl, facebook, instagram }, { status: 200 });
```

- [ ] **Step 5: Rodar os testes e confirmar que passam**

Run: `npm test`
Expected: PASS — suíte inteira, incluindo os testes de `pipeline.test.ts` ajustados e os dois novos de `route.test.ts`.

Run: `npm run typecheck`
Expected: sem erros.

- [ ] **Step 6: Documentar variáveis de ambiente**

Adicionar ao final de `.env.example`:

```bash
# Token de acesso System User da Meta (Business Manager > System Users) —
# permanente, não expira por tempo. Precisa das permissões:
# pages_manage_posts, pages_manage_engagement, pages_read_engagement,
# instagram_basic, instagram_content_publish.
META_SYSTEM_USER_TOKEN=

# ID da Página do Facebook onde o post é publicado.
META_PAGE_ID=

# ID da conta comercial do Instagram (conectada à Página acima).
META_IG_BUSINESS_ACCOUNT_ID=
```

- [ ] **Step 7: Documentar no runbook**

Adicionar uma nova seção `## 10. Instagram e Facebook (opcional, sub-projeto separado)` em `docs/runbook.md`, depois da seção 9 (Telegram) existente:

```markdown
## 10. Instagram e Facebook (opcional, sub-projeto separado)

Cobre a postagem automática da mesma promoção no Facebook e no Instagram, junto com o post do blog (ver `docs/superpowers/specs/2026-07-29-instagram-facebook-posting-design.md`).

### 10.1 Gerar o token System User

1. Acesse o Business Manager (business.facebook.com) da conta que já tem a Página do Facebook e o Instagram comercial conectados.
2. Vá em Configurações do negócio > Usuários > Usuários do sistema > Adicionar.
3. Crie um System User (papel Admin é o mais simples).
4. Em "Adicionar ativos", conecte a Página do Facebook e a conta do Instagram a esse System User, com controle total.
5. Gere um token de acesso pra esse System User com as permissões: `pages_manage_posts`, `pages_manage_engagement`, `pages_read_engagement`, `instagram_basic`, `instagram_content_publish`. Esse token não expira por tempo — vai em `META_SYSTEM_USER_TOKEN`.

### 10.2 Descobrir os IDs

- **ID da Página:** aparece em Configurações da Página no Facebook, ou via `GET https://graph.facebook.com/v26.0/me/accounts?access_token=<token>` (lista as Páginas que o System User administra).
- **ID da conta do Instagram:** `GET https://graph.facebook.com/v26.0/<page-id>?fields=instagram_business_account&access_token=<token>`.

Configure `META_PAGE_ID` e `META_IG_BUSINESS_ACCOUNT_ID` na Vercel com os valores encontrados.

### 10.3 Teste manual

Depois do deploy, disparar o webhook normalmente (seção 6) com um link real do Mercado Livre e conferir na resposta os campos `facebook`/`instagram`:

```json
{ "postUrl": "...", "facebook": { "ok": true, "postId": "..." }, "instagram": { "ok": true, "postId": "..." } }
```

Conferir também que o post apareceu de fato na Página do Facebook e no perfil do Instagram, com a imagem do produto e a legenda com preço/cupom/link/hashtags.

### 10.4 Se algo falhar

O campo `facebook` ou `instagram` na resposta vem como `{ "ok": false, "error": "..." }` — o post do blog sai normalmente mesmo assim. O erro também fica nos logs da função (`console.error`). Erros comuns:
- Token revogado ou permissão removida no Business Manager — gere um novo token (seção 10.1).
- Imagem do produto inacessível pro fetcher da Meta — confira se a URL da imagem do Mercado Livre abre normalmente num navegador anônimo.
```

- [ ] **Step 8: Commit**

```bash
git add src/app/api/webhook/route.ts src/app/api/webhook/route.test.ts src/lib/pipeline.ts src/lib/pipeline.test.ts .env.example docs/runbook.md
git commit -m "feat: postar no Facebook e Instagram depois de publicar no blog (best-effort)"
```
