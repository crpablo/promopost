# Instagram Stories Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Depois que o feed do Instagram/Facebook é postado, gerar uma imagem de Story (foto do produto + preço/cupom desenhados sobre uma faixa de degradê) e publicá-la no Instagram, como mais um passo *best-effort*.

**Architecture:** Uma rota nova (`GET /api/story-image`) usa `next/og`'s `ImageResponse` (já incluso no Next.js App Router, sem dependência nova) pra compor a imagem sob demanda a partir de query params. `instagram.ts` ganha `postStoryToInstagram`, reaproveitando o fluxo de container+espera+publish já existente com `media_type: STORIES`. `route.ts` do webhook monta a URL da imagem e chama essa função como um terceiro passo best-effort, em paralelo com Facebook e Instagram feed — independente do resultado da legenda do feed.

**Tech Stack:** `next/og` (`ImageResponse`, já bundled no Next.js App Router — **não precisa instalar `@vercel/og`** como dependência separada), Graph API da Meta (`media_type: STORIES`), TypeScript, Vitest.

## Global Constraints

- Node >=24, TypeScript estrito (configs já existentes no projeto).
- Todo texto voltado ao usuário/operador (erros, docs) em português.
- Story é *best-effort*, independente de feed e blog: falha em gerar a imagem ou postar o Story não pode afetar o resultado do blog, do post de feed do Facebook, nem do post de feed do Instagram — e vice-versa. Sem retentativa automática.
- **Sem legenda nem link no Story** — confirmado que a API não suporta nenhum dos dois pra esse tipo de mídia. A imagem carrega só título, preço de/por (ou preço único) e cupom, desenhados nos pixels.
- Reaproveita a mesma trava `isMetaConfigured()` e o mesmo padrão de resposta `{ok, postId?, error?}` já usados por Facebook/Instagram feed (`src/app/api/webhook/route.ts`), estendendo pra incluir um terceiro campo `story`.
- Não modifica `src/lib/social/caption.ts`, `src/lib/social/facebook.ts`, nem a lógica de Facebook/Instagram feed já existente em `instagram.ts`/`route.ts` além do necessário pra adicionar o Story.

---

### Task 1: Story Image Renderer

**Files:**
- Create: `src/app/api/story-image/route.ts`
- Test: `src/app/api/story-image/route.test.ts`

**Interfaces:**
- Produces: `GET /api/story-image?imageUrl=<url>&title=<texto>&price=<número>&discountedPrice=<número opcional>&coupon=<texto opcional>` → resposta de imagem PNG 1080×1920 quando os parâmetros obrigatórios (`imageUrl`, `title`, `price`) estão presentes; `400` com `{ erro: string }` em JSON quando algum falta. Usada pela Task 3 (o webhook monta essa URL e passa pro Instagram buscar).

- [ ] **Step 1: Escrever os testes que falham**

Criar `src/app/api/story-image/route.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import { GET } from './route';

describe('GET /api/story-image', () => {
  it('retorna 400 quando falta o parâmetro imageUrl', async () => {
    const request = new Request(
      'https://promopost.example.com/api/story-image?title=Produto&price=99.9',
    );
    const response = await GET(request);
    const json = await response.json();

    expect(response.status).toBe(400);
    expect(json).toEqual({
      erro: 'Parâmetros obrigatórios ausentes: imageUrl, title, price',
    });
  });

  it('retorna 400 quando não tem nenhum parâmetro', async () => {
    const request = new Request('https://promopost.example.com/api/story-image');
    const response = await GET(request);

    expect(response.status).toBe(400);
  });
});
```

- [ ] **Step 2: Rodar os testes e confirmar que falham**

Run: `npm test -- story-image`
Expected: FAIL — `Cannot find module './route'`

- [ ] **Step 3: Implementar a rota**

Criar `src/app/api/story-image/route.tsx` (extensão `.tsx`, não `.ts` — o arquivo contém JSX):

```tsx
import { ImageResponse } from 'next/og';

function formatPrice(value: number): string {
  return value.toLocaleString('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export async function GET(request: Request): Promise<Response> {
  const { searchParams } = new URL(request.url);
  const imageUrl = searchParams.get('imageUrl');
  const title = searchParams.get('title');
  const priceParam = searchParams.get('price');
  const discountedPriceParam = searchParams.get('discountedPrice');
  const coupon = searchParams.get('coupon');

  if (!imageUrl || !title || !priceParam) {
    return Response.json(
      { erro: 'Parâmetros obrigatórios ausentes: imageUrl, title, price' },
      { status: 400 },
    );
  }

  const price = Number(priceParam);
  const discountedPrice = discountedPriceParam ? Number(discountedPriceParam) : undefined;

  return new ImageResponse(
    (
      <div style={{ width: '100%', height: '100%', display: 'flex', position: 'relative' }}>
        <img
          src={imageUrl}
          style={{
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            position: 'absolute',
            display: 'flex',
          }}
        />
        <div
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            bottom: 0,
            display: 'flex',
            flexDirection: 'column',
            background: 'linear-gradient(to top, rgba(0,0,0,0.85), rgba(0,0,0,0))',
            padding: '40px 32px 56px',
          }}
        >
          <div style={{ display: 'flex', color: 'white', fontSize: 34, fontWeight: 700 }}>
            {title}
          </div>
          {typeof discountedPrice === 'number' ? (
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              <div
                style={{
                  display: 'flex',
                  color: 'rgba(255,255,255,0.75)',
                  fontSize: 26,
                  textDecoration: 'line-through',
                  marginTop: 8,
                }}
              >
                De R${formatPrice(price)}
              </div>
              <div style={{ display: 'flex', color: '#ffe14d', fontSize: 52, fontWeight: 700 }}>
                R${formatPrice(discountedPrice)}
              </div>
            </div>
          ) : (
            <div
              style={{
                display: 'flex',
                color: '#ffe14d',
                fontSize: 52,
                fontWeight: 700,
                marginTop: 8,
              }}
            >
              R${formatPrice(price)}
            </div>
          )}
          {coupon ? (
            <div
              style={{
                display: 'flex',
                color: 'white',
                fontSize: 26,
                background: '#ff3b5c',
                padding: '6px 20px',
                borderRadius: 999,
                marginTop: 12,
                alignSelf: 'flex-start',
              }}
            >
              🎟️ {coupon}
            </div>
          ) : null}
        </div>
      </div>
    ),
    { width: 1080, height: 1920 },
  );
}
```

**Nota:** o arquivo de teste do Step 1 deve ser salvo como `route.test.ts` (sem JSX, não precisa de `.tsx`), mas o arquivo da rota em si precisa ser `route.tsx` porque contém JSX — ajuste o import no teste de `'./route'` (funciona normalmente, TypeScript resolve `.tsx` e `.ts` pelo mesmo especificador).

- [ ] **Step 4: Rodar os testes e confirmar que passam**

Run: `npm test -- story-image`
Expected: PASS (2 testes)

- [ ] **Step 5: Verificação visual manual (obrigatória — a rota não é testável por asserção de string além da validação de parâmetros)**

Rode `npm run dev` e abra no navegador esta URL (produto real já usado em testes anteriores do projeto):

```
http://localhost:3000/api/story-image?imageUrl=https%3A%2F%2Fhttp2.mlstatic.com%2FD_NQ_NP_979197-MLB114050838517_072026-O-tnis-slip-on-iate-masculino-couro-confortavel.webp&title=T%C3%AAnis%20Slip%20On%20Iate%20Masculino&price=164.9&discountedPrice=131.92&coupon=GOLMELI

```

Confirme visualmente: a imagem carrega, tem proporção vertical (1080×1920), o texto está legível sobre o degradê, nada corta o título nem o cupom. Teste também sem `discountedPrice` nem `coupon` (só `imageUrl`, `title`, `price`) pra conferir o caminho de preço único.

**Se o Satori (motor de renderização do `next/og`) rejeitar alguma propriedade CSS** (a resposta vem como erro em vez de imagem), o erro geralmente aponta a propriedade não suportada — ajuste o JSX até renderizar. Causas comuns: elemento sem `display: 'flex'` explícito, ou propriedade CSS fora do subconjunto suportado (só flexbox, sem `display: grid`).

- [ ] **Step 6: Commit**

```bash
git add src/app/api/story-image/route.tsx src/app/api/story-image/route.test.ts
git commit -m "feat: rota que gera imagem de Story com preço/cupom sobre a foto do produto"
```

---

### Task 2: Instagram Stories Publisher

**Files:**
- Modify: `src/lib/social/instagram.ts`
- Modify: `src/lib/social/instagram.test.ts`

**Interfaces:**
- Consumes: nada novo — reaproveita `getConfig()` e `waitForContainerReady()`, já definidas no arquivo (não redeclare essas funções).
- Produces: `postStoryToInstagram(imageUrl: string): Promise<SocialPostResult>` — usada pela Task 3. `SocialPostResult` já existe (`{ postId: string }`, importado de `./facebook`).

- [ ] **Step 1: Escrever os testes que falham**

Adicionar ao final de `src/lib/social/instagram.test.ts` (dentro do mesmo arquivo, depois do último `describe`/antes do fechamento, como um novo bloco `describe` no mesmo nível de `describe('postToInstagram', ...)`), e adicionar `postStoryToInstagram` ao import do topo do arquivo (`import { postStoryToInstagram, postToInstagram } from './instagram';`):

```typescript
describe('postStoryToInstagram', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.useRealTimers();
  });

  it('cria o container como STORIES, sem legenda, espera ficar pronto e publica', async () => {
    stubEnv();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ id: 'container_1' }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ status_code: 'FINISHED' }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ id: 'story_999' }) });
    vi.stubGlobal('fetch', fetchMock);

    const result = await postStoryToInstagram('https://promopost.vercel.app/api/story-image?x=y');

    expect(result).toEqual({ postId: 'story_999' });
    expect(fetchMock).toHaveBeenCalledTimes(3);

    const [createUrl, createOptions] = fetchMock.mock.calls[0];
    expect(createUrl).toBe('https://graph.facebook.com/v26.0/17841400000000000/media');
    expect(JSON.parse(createOptions.body)).toEqual({
      image_url: 'https://promopost.vercel.app/api/story-image?x=y',
      media_type: 'STORIES',
      access_token: 'fake-token',
    });

    const [publishUrl, publishOptions] = fetchMock.mock.calls[2];
    expect(publishUrl).toBe('https://graph.facebook.com/v26.0/17841400000000000/media_publish');
    expect(JSON.parse(publishOptions.body)).toEqual({
      creation_id: 'container_1',
      access_token: 'fake-token',
    });
  });

  it('lança erro quando a criação do container do Story falha', async () => {
    stubEnv();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        json: async () => ({ error: { message: 'Imagem inválida' } }),
      }),
    );

    await expect(postStoryToInstagram('https://x.com/story.png')).rejects.toThrow(
      'Falha ao criar mídia do Story: Imagem inválida',
    );
  });

  it('lança erro quando a publicação do Story falha', async () => {
    stubEnv();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ id: 'container_1' }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ status_code: 'FINISHED' }) })
      .mockResolvedValueOnce({
        ok: false,
        json: async () => ({ error: { message: 'Container expirado' } }),
      });
    vi.stubGlobal('fetch', fetchMock);

    await expect(postStoryToInstagram('https://x.com/story.png')).rejects.toThrow(
      'Falha ao publicar Story do Instagram: Container expirado',
    );
  });

  it('lança erro quando faltam variáveis de ambiente', async () => {
    await expect(postStoryToInstagram('https://x.com/story.png')).rejects.toThrow(
      'Variáveis de ambiente da Meta ausentes',
    );
  });
});
```

- [ ] **Step 2: Rodar os testes e confirmar que falham**

Run: `npm test -- instagram.test.ts`
Expected: FAIL — `postStoryToInstagram` não está definida/exportada ainda.

- [ ] **Step 3: Implementar `postStoryToInstagram`**

Adicionar ao final de `src/lib/social/instagram.ts` (depois da função `postToInstagram` já existente — não modifique `postToInstagram`, `getConfig`, nem `waitForContainerReady`):

```typescript
export async function postStoryToInstagram(imageUrl: string): Promise<SocialPostResult> {
  const config = getConfig();

  const createRes = await fetch(`https://graph.facebook.com/v26.0/${config.igUserId}/media`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      image_url: imageUrl,
      media_type: 'STORIES',
      access_token: config.accessToken,
    }),
  });
  const createJson = await createRes.json();
  if (!createRes.ok || createJson.error || !createJson.id) {
    throw new Error(`Falha ao criar mídia do Story: ${createJson.error?.message ?? createRes.status}`);
  }

  await waitForContainerReady(createJson.id, config.accessToken);

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
      `Falha ao publicar Story do Instagram: ${publishJson.error?.message ?? publishRes.status}`,
    );
  }

  return { postId: publishJson.id };
}
```

- [ ] **Step 4: Rodar os testes e confirmar que passam**

Run: `npm test -- instagram.test.ts`
Expected: PASS (8 testes — 4 de `postToInstagram` + 4 novos de `postStoryToInstagram`)

- [ ] **Step 5: Commit**

```bash
git add src/lib/social/instagram.ts src/lib/social/instagram.test.ts
git commit -m "feat: publicar Story no Instagram (media_type STORIES, sem legenda)"
```

---

### Task 3: Integrar o Story no webhook

**Files:**
- Modify: `src/app/api/webhook/route.ts`
- Modify: `src/app/api/webhook/route.test.ts`
- Modify: `docs/runbook.md`

**Interfaces:**
- Consumes: `postStoryToInstagram(imageUrl: string): Promise<SocialPostResult>` (Task 2); a rota `GET /api/story-image` (Task 1) — só chamada via URL montada com `URLSearchParams`, não importada como função.
- Produces: resposta do webhook estendida com um terceiro campo `story: {ok, postId?, error?}`, ao lado de `facebook`/`instagram` já existentes.

**Decisão de design importante:** o Story **não depende da legenda do feed** (`buildSocialCaption`) — ele usa dados brutos do produto (`title`, `price`, `discountedPrice`, `coupon`) direto na URL da imagem, sem passar pelo texto da legenda. Por isso, se `buildSocialCaption` falhar (ex: produto malformado), isso deve continuar derrubando só `facebook`/`instagram` — o Story deve ser tentado de qualquer forma, de forma totalmente independente. Preste atenção a isso no Step 3 abaixo: o Story começa a ser processado **antes** do bloco try/catch da legenda, em paralelo, não depois.

- [ ] **Step 1: Ler o estado atual do arquivo**

`src/app/api/webhook/route.ts` hoje tem uma função `postToSocialNetworks` que: checa `isMetaConfigured()`, monta a legenda com `buildSocialCaption`, e roda `postToFacebook`/`postToInstagram` em paralelo via `Promise.all`, devolvendo `{facebook, instagram}`. Leia o arquivo completo antes de editar pra confirmar que bate com essa descrição (pode ter mudado desde a escrita deste plano).

- [ ] **Step 2: Escrever os testes que falham**

Substituir o conteúdo de `src/app/api/webhook/route.test.ts` inteiro por (mantém a mesma estrutura de mocks já existente, adicionando `postStoryToInstagram`):

```typescript
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/mercadolivre/parseLink', () => ({ parseItemId: vi.fn() }));
vi.mock('@/lib/mercadolivre/affiliateLink', () => ({ fetchProductAndAffiliateLink: vi.fn() }));
vi.mock('@/lib/content/template', () => ({ buildPostText: vi.fn() }));
vi.mock('@/lib/shopify/publisher', () => ({ publishArticle: vi.fn() }));
vi.mock('@/lib/social/caption', () => ({ buildSocialCaption: vi.fn() }));
vi.mock('@/lib/social/facebook', () => ({ postToFacebook: vi.fn() }));
vi.mock('@/lib/social/instagram', () => ({ postToInstagram: vi.fn(), postStoryToInstagram: vi.fn() }));

import { buildPostText } from '@/lib/content/template';
import { fetchProductAndAffiliateLink } from '@/lib/mercadolivre/affiliateLink';
import { parseItemId } from '@/lib/mercadolivre/parseLink';
import { SessionExpiredError } from '@/lib/pipeline';
import { publishArticle } from '@/lib/shopify/publisher';
import { buildSocialCaption } from '@/lib/social/caption';
import { postToFacebook } from '@/lib/social/facebook';
import { postStoryToInstagram, postToInstagram } from '@/lib/social/instagram';
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

  it('retorna 200 com a url do post no caminho feliz, e posta no Facebook, Instagram e Story', async () => {
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
    expect(json).toEqual({
      postUrl: 'https://loja.myshopify.com/blogs/noticias/produto-x',
      facebook: { ok: true, postId: 'fb-1' },
      instagram: { ok: true, postId: 'ig-1' },
      story: { ok: true, postId: 'story-1' },
    });
    expect(postToFacebook).toHaveBeenCalledWith('https://x.com/img.jpg', 'legenda social');
    expect(postToInstagram).toHaveBeenCalledWith('https://x.com/img.jpg', 'legenda social');

    expect(postStoryToInstagram).toHaveBeenCalledTimes(1);
    const [storyImageUrl] = vi.mocked(postStoryToInstagram).mock.calls[0];
    expect(storyImageUrl.startsWith('https://promopost.example.com/api/story-image?')).toBe(true);
    const params = new URL(storyImageUrl).searchParams;
    expect(params.get('imageUrl')).toBe('https://x.com/img.jpg');
    expect(params.get('title')).toBe('Produto X');
    expect(params.get('price')).toBe('99.9');
  });

  it('retorna postUrl mesmo quando Facebook, Instagram e Story falham (best-effort, não derruba o blog)', async () => {
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
    vi.mocked(postToFacebook).mockRejectedValue(new Error('Token inválido'));
    vi.mocked(postToInstagram).mockRejectedValue(new Error('Imagem inválida'));
    vi.mocked(postStoryToInstagram).mockRejectedValue(new Error('Story indisponível'));

    const response = await POST(makeRequest({ link: 'https://mercadolivre.com.br/MLB123' }));
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json).toEqual({
      postUrl: 'https://loja.myshopify.com/blogs/noticias/produto-x',
      facebook: { ok: false, error: 'Token inválido' },
      instagram: { ok: false, error: 'Imagem inválida' },
      story: { ok: false, error: 'Story indisponível' },
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
    });
    expect(postToFacebook).not.toHaveBeenCalled();
    expect(postToInstagram).not.toHaveBeenCalled();
    expect(postStoryToInstagram).toHaveBeenCalledTimes(1);
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
    });
    expect(postStoryToInstagram).not.toHaveBeenCalled();
  });

  it('pula Facebook, Instagram e Story quando as variáveis da Meta não estão configuradas', async () => {
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

    const response = await POST(makeRequest({ link: 'https://mercadolivre.com.br/MLB123' }));
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json).toEqual({
      postUrl: 'https://loja.myshopify.com/blogs/noticias/produto-x',
      facebook: { ok: false, error: 'não configurado' },
      instagram: { ok: false, error: 'não configurado' },
      story: { ok: false, error: 'não configurado' },
    });
    expect(buildSocialCaption).not.toHaveBeenCalled();
    expect(postToFacebook).not.toHaveBeenCalled();
    expect(postToInstagram).not.toHaveBeenCalled();
    expect(postStoryToInstagram).not.toHaveBeenCalled();
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
Expected: FAIL — vários testes falham porque `route.ts` ainda não tem `story` na resposta, nem chama `postStoryToInstagram`.

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

export const maxDuration = 300;

type SocialResult = { ok: true; postId: string } | { ok: false; error: string };

function isMetaConfigured(): boolean {
  return Boolean(
    process.env.META_PAGE_ID && process.env.META_IG_BUSINESS_ACCOUNT_ID && process.env.META_SYSTEM_USER_TOKEN,
  );
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

async function postToSocialNetworks(
  product: Product,
  affiliateLink: string,
  coupon?: string,
  discountedPrice?: number,
): Promise<{ facebook: SocialResult; instagram: SocialResult; story: SocialResult }> {
  if (!isMetaConfigured()) {
    const naoConfigurado: SocialResult = { ok: false, error: 'não configurado' };
    return { facebook: naoConfigurado, instagram: naoConfigurado, story: naoConfigurado };
  }

  // O Story não depende da legenda do feed — usa dados brutos do produto
  // direto na URL da imagem, então começa em paralelo, independente do
  // resultado de buildSocialCaption abaixo.
  const storyResultPromise: Promise<SocialResult> = Promise.resolve()
    .then(() => buildStoryImageUrl(product, coupon, discountedPrice))
    .then((storyImageUrl) => postStoryToInstagram(storyImageUrl))
    .then((r): SocialResult => ({ ok: true, postId: r.postId }))
    .catch((err: unknown): SocialResult => {
      console.error('Erro ao postar Story no Instagram:', err);
      return { ok: false, error: toErrorMessage(err) };
    });

  let caption: string;
  try {
    caption = buildSocialCaption(product, affiliateLink, coupon, discountedPrice);
  } catch (err) {
    console.error('Erro ao montar legenda social:', err);
    const erro: SocialResult = { ok: false, error: toErrorMessage(err) };
    const story = await storyResultPromise;
    return { facebook: erro, instagram: erro, story };
  }

  const [facebook, instagram, story] = await Promise.all([
    postToFacebook(product.imageUrl, caption)
      .then((r): SocialResult => ({ ok: true, postId: r.postId }))
      .catch((err: unknown): SocialResult => {
        console.error('Erro ao postar no Facebook:', err);
        return { ok: false, error: toErrorMessage(err) };
      }),
    postToInstagram(product.imageUrl, caption)
      .then((r): SocialResult => ({ ok: true, postId: r.postId }))
      .catch((err: unknown): SocialResult => {
        console.error('Erro ao postar no Instagram:', err);
        return { ok: false, error: toErrorMessage(err) };
      }),
    storyResultPromise,
  ]);

  return { facebook, instagram, story };
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

    const { facebook, instagram, story } = await postToSocialNetworks(
      result.product,
      result.affiliateLink,
      body.coupon,
      body.discountedPrice,
    );

    return Response.json({ postUrl: result.postUrl, facebook, instagram, story }, { status: 200 });
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

- [ ] **Step 6: Documentar no runbook**

Adicionar ao final da seção `## 10. Instagram e Facebook` em `docs/runbook.md` (depois da subseção `### 10.4 Se algo falhar` já existente), uma nova subseção:

```markdown
### 10.5 Stories do Instagram

O mesmo gatilho do feed também posta um Story (imagem do produto + preço/cupom desenhados sobre a foto, sem link nem legenda — a API do Instagram não suporta nenhum dos dois nesse tipo de mídia). Usa as mesmas variáveis `META_IG_BUSINESS_ACCOUNT_ID`/`META_SYSTEM_USER_TOKEN` já configuradas na seção 10.1, mais `WEBHOOK_BASE_URL` (já configurada na seção 9.3, reaproveitada aqui).

A resposta do webhook ganha um terceiro campo, `story`, no mesmo formato de `facebook`/`instagram`:

```json
{ "postUrl": "...", "facebook": {...}, "instagram": {...}, "story": { "ok": true, "postId": "..." } }
```

Pra conferir o resultado visual da imagem gerada antes de postar de verdade, abra direto no navegador: `https://promopost.vercel.app/api/story-image?imageUrl=<url da foto>&title=<nome>&price=<preço>&discountedPrice=<preço com desconto, opcional>&coupon=<cupom, opcional>` (parâmetros de query com URL-encoding).

Se `story` vier com erro: mesma tabela de causas prováveis da seção 10.4 (token/permissão, imagem inacessível) — mais um caso específico do Story: `WEBHOOK_BASE_URL não configurado` significa que essa variável (usada aqui pra montar a URL pública da imagem) está faltando.
```

- [ ] **Step 7: Commit**

```bash
git add src/app/api/webhook/route.ts src/app/api/webhook/route.test.ts docs/runbook.md
git commit -m "feat: postar Story no Instagram junto com o feed (best-effort, independente da legenda)"
```
