# Telegram Trigger Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Vercel Cron poller that reads a Telegram group/channel via a userbot (GramJS/MTProto), extracts Mercado Livre promo links + coupon + discounted price from free-text messages via an LLM, and feeds them into the existing `/api/webhook` pipeline — automatically turning group promos into blog drafts.

**Architecture:** A Vercel Cron job (`GET /api/telegram-poll`, every ~3 minutes) connects to Telegram using a saved userbot session, fetches messages newer than a saved cursor, runs each through an LLM extractor, and calls the existing webhook for every recognized Mercado Livre promo (with optional coupon/discounted-price). `template.ts` gains a "de/por com cupom" rendering path; everything else in the existing pipeline is reused unchanged.

**Tech Stack:** GramJS (`telegram` npm package, official Telegram MTProto client API), Vercel AI SDK (`ai` + `zod`) via Vercel AI Gateway, Vercel Cron (`vercel.ts`), Vercel Blob (session + cursor storage), Vitest.

## Global Constraints

- Runtime alvo: Node.js 24. TypeScript em modo `strict`. Framework de teste: Vitest.
- Todo texto de post/erro voltado ao usuário fica em português.
- Telegram é acessado via API oficial de cliente (GramJS/MTProto), nunca Bot API — a conta é apenas membro do grupo/canal alvo, não administradora.
- A automação usa uma conta Telegram secundária, dedicada — não a conta pessoal principal do usuário. Isso é uma instrução operacional (documentada no runbook), não algo que o código força.
- Sem retry automático: uma mensagem cujo processamento falhar (extração ou webhook) tem o erro registrado, mas o cursor avança mesmo assim — nunca fica presa reprocessando pra sempre.
- O gatilho Telegram só chama o webhook existente (`POST /api/webhook`) — não duplica lógica de geração de link de afiliado, busca de produto ou publicação.
- Mudanças em `template.ts`, `pipeline.ts` e `route.ts` do webhook existente são **aditivas**: os parâmetros novos (`coupon`, `discountedPrice`) são opcionais, e o comportamento atual (sem cupom) fica idêntico ao que já existe e já está em produção.
- Chamadas de LLM usam o Vercel AI Gateway com string de modelo `"provider/modelo"` (via pacote `ai`), não um SDK de provedor específico.
- Cada execução do cron processa um lote limitado de mensagens (ver Task 6) — cada chamada ao webhook já observado em produção leva de ~10 a ~65 segundos, então processar muitas de uma vez arrisca estourar o timeout da function.

---

## File Structure

```
package.json                                          # MODIFY: novas dependências
vercel.ts                                              # CREATE: agendamento do cron
.env.example                                            # MODIFY: novas env vars
docs/runbook.md                                         # MODIFY: passo a passo Telegram
scripts/
  bootstrap-telegram-session.mjs                        # CREATE
src/
  lib/
    telegram/
      sessionStore.ts                                    # CREATE
      sessionStore.test.ts                               # CREATE
      cursorStore.ts                                      # CREATE
      cursorStore.test.ts                                 # CREATE
      extractPromo.ts                                      # CREATE
      extractPromo.test.ts                                 # CREATE
      poller.ts                                             # CREATE
      poller.test.ts                                        # CREATE
    content/
      template.ts                                           # MODIFY
      template.test.ts                                       # MODIFY
    pipeline.ts                                               # MODIFY
    pipeline.test.ts                                           # MODIFY
  app/
    api/
      webhook/
        route.ts                                                # MODIFY
        route.test.ts                                            # MODIFY
      telegram-poll/
        route.ts                                                  # CREATE
```

---

### Task 1: Dependências novas + Telegram Session Store

**Files:**
- Modify: `package.json`
- Create: `src/lib/telegram/sessionStore.ts`
- Test: `src/lib/telegram/sessionStore.test.ts`

**Interfaces:**
- Produces: `async function loadSession(): Promise<string>`, exportada de `src/lib/telegram/sessionStore.ts`. Lê a sessão GramJS (string) salva no Vercel Blob.

- [ ] **Step 1: Adicionar dependências novas ao `package.json`**

No objeto `dependencies`, adicione (mantendo o que já existe):
```json
"ai": "^5.0.0",
"zod": "^3.23.0",
"telegram": "^2.26.0"
```
No objeto `devDependencies`, adicione:
```json
"@vercel/config": "^1.0.0"
```

- [ ] **Step 2: Instalar**

Run: `npm install`
Expected: instala sem erro, atualiza `package-lock.json`.

- [ ] **Step 3: Escrever o teste que falha primeiro**

Create `src/lib/telegram/sessionStore.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadSession } from './sessionStore';

describe('loadSession', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('baixa a sessão da url configurada usando o token como bearer', async () => {
    vi.stubEnv('TELEGRAM_SESSION_BLOB_URL', 'https://blob.vercel-storage.com/telegram-session.txt');
    vi.stubEnv('BLOB_READ_WRITE_TOKEN', 'fake-token');

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => '  1BQANOTE...sessionstring...  \n',
    });
    vi.stubGlobal('fetch', fetchMock);

    const session = await loadSession();

    expect(fetchMock).toHaveBeenCalledWith('https://blob.vercel-storage.com/telegram-session.txt', {
      headers: { authorization: 'Bearer fake-token' },
    });
    expect(session).toBe('1BQANOTE...sessionstring...');
  });

  it('lança erro quando TELEGRAM_SESSION_BLOB_URL não está configurada', async () => {
    vi.stubEnv('TELEGRAM_SESSION_BLOB_URL', '');
    await expect(loadSession()).rejects.toThrow('TELEGRAM_SESSION_BLOB_URL não configurada');
  });

  it('lança erro quando a resposta não é ok', async () => {
    vi.stubEnv('TELEGRAM_SESSION_BLOB_URL', 'https://blob.vercel-storage.com/telegram-session.txt');
    vi.stubEnv('BLOB_READ_WRITE_TOKEN', 'fake-token');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 403 }));

    await expect(loadSession()).rejects.toThrow('Falha ao carregar sessão do Telegram: 403');
  });
});
```

- [ ] **Step 4: Rodar o teste e confirmar que falha**

Run: `npx vitest run src/lib/telegram/sessionStore.test.ts`
Expected: FAIL — `Cannot find module './sessionStore'`.

- [ ] **Step 5: Implementar `loadSession`**

Create `src/lib/telegram/sessionStore.ts`:

```ts
export async function loadSession(): Promise<string> {
  const url = process.env.TELEGRAM_SESSION_BLOB_URL;
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!url) {
    throw new Error('TELEGRAM_SESSION_BLOB_URL não configurada');
  }
  const res = await fetch(url, {
    headers: { authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    throw new Error(`Falha ao carregar sessão do Telegram: ${res.status}`);
  }
  const text = await res.text();
  return text.trim();
}
```

- [ ] **Step 6: Rodar o teste e confirmar que passa**

Run: `npx vitest run src/lib/telegram/sessionStore.test.ts`
Expected: PASS (3 testes).

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json src/lib/telegram/sessionStore.ts src/lib/telegram/sessionStore.test.ts
git commit -m "feat: dependências do gatilho Telegram + session store"
```

---

### Task 2: Cursor Store

**Files:**
- Create: `src/lib/telegram/cursorStore.ts`
- Test: `src/lib/telegram/cursorStore.test.ts`

**Interfaces:**
- Produces: `async function loadCursor(): Promise<number | null>` e `async function saveCursor(messageId: number): Promise<void>`, exportadas de `src/lib/telegram/cursorStore.ts`.

**Nota:** diferente da sessão (que exige um bootstrap manual humano), o cursor é gerenciado inteiramente pelo próprio app — não precisa de env var apontando pra URL do blob. Usa `list()` do `@vercel/blob` pra achar o blob pelo pathname fixo, então não há problema de "primeira execução" sem URL configurada: se não achar nada, `loadCursor` retorna `null` (processa desde o início).

- [ ] **Step 1: Escrever o teste que falha primeiro**

Create `src/lib/telegram/cursorStore.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from 'vitest';

const { listMock, putMock } = vi.hoisted(() => ({
  listMock: vi.fn(),
  putMock: vi.fn(),
}));

vi.mock('@vercel/blob', () => ({
  list: listMock,
  put: putMock,
}));

import { loadCursor, saveCursor } from './cursorStore';

describe('loadCursor', () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it('retorna null quando não existe cursor salvo ainda', async () => {
    listMock.mockResolvedValue({ blobs: [] });

    const cursor = await loadCursor();

    expect(cursor).toBeNull();
  });

  it('baixa e retorna o lastMessageId do cursor salvo', async () => {
    listMock.mockResolvedValue({
      blobs: [{ pathname: 'telegram-cursor.json', url: 'https://blob.vercel-storage.com/telegram-cursor.json' }],
    });
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ lastMessageId: 4242 }) }),
    );

    const cursor = await loadCursor();

    expect(cursor).toBe(4242);
  });

  it('lança erro quando o download do cursor falha', async () => {
    listMock.mockResolvedValue({
      blobs: [{ pathname: 'telegram-cursor.json', url: 'https://blob.vercel-storage.com/telegram-cursor.json' }],
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 }));

    await expect(loadCursor()).rejects.toThrow('Falha ao carregar cursor do Telegram: 500');
  });
});

describe('saveCursor', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('grava o lastMessageId no pathname fixo, sobrescrevendo o anterior', async () => {
    putMock.mockResolvedValue({ url: 'https://blob.vercel-storage.com/telegram-cursor.json' });

    await saveCursor(4242);

    expect(putMock).toHaveBeenCalledWith(
      'telegram-cursor.json',
      JSON.stringify({ lastMessageId: 4242 }),
      expect.objectContaining({ access: 'private', allowOverwrite: true, addRandomSuffix: false }),
    );
  });
});
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

Run: `npx vitest run src/lib/telegram/cursorStore.test.ts`
Expected: FAIL — `Cannot find module './cursorStore'`.

- [ ] **Step 3: Implementar `loadCursor` e `saveCursor`**

Create `src/lib/telegram/cursorStore.ts`:

```ts
import { list, put } from '@vercel/blob';

const CURSOR_PATHNAME = 'telegram-cursor.json';

export async function loadCursor(): Promise<number | null> {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  const { blobs } = await list({ prefix: CURSOR_PATHNAME, token });
  const match = blobs.find((b) => b.pathname === CURSOR_PATHNAME);
  if (!match) {
    return null;
  }
  const res = await fetch(match.url, {
    headers: { authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    throw new Error(`Falha ao carregar cursor do Telegram: ${res.status}`);
  }
  const data = await res.json();
  return typeof data.lastMessageId === 'number' ? data.lastMessageId : null;
}

export async function saveCursor(messageId: number): Promise<void> {
  await put(CURSOR_PATHNAME, JSON.stringify({ lastMessageId: messageId }), {
    access: 'private',
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: 'application/json',
    token: process.env.BLOB_READ_WRITE_TOKEN,
  });
}
```

- [ ] **Step 4: Rodar o teste e confirmar que passa**

Run: `npx vitest run src/lib/telegram/cursorStore.test.ts`
Expected: PASS (4 testes).

- [ ] **Step 5: Commit**

```bash
git add src/lib/telegram/cursorStore.ts src/lib/telegram/cursorStore.test.ts
git commit -m "feat: cursor store do gatilho Telegram (auto-inicializável)"
```

---

### Task 3: Promo Extractor (LLM)

**Files:**
- Create: `src/lib/telegram/extractPromo.ts`
- Test: `src/lib/telegram/extractPromo.test.ts`

**Interfaces:**
- Produces: `interface PromoExtraction { isMercadoLivrePromo: boolean; link: string | null; coupon: string | null; discountedPrice: number | null }` e `async function extractPromo(messageText: string): Promise<PromoExtraction>`, exportadas de `src/lib/telegram/extractPromo.ts`.

- [ ] **Step 1: Escrever o teste que falha primeiro**

Create `src/lib/telegram/extractPromo.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from 'vitest';

const { generateObjectMock } = vi.hoisted(() => ({ generateObjectMock: vi.fn() }));

vi.mock('ai', () => ({ generateObject: generateObjectMock }));

import { extractPromo } from './extractPromo';

describe('extractPromo', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('extrai link, cupom e preço com desconto de uma promo do Mercado Livre', async () => {
    generateObjectMock.mockResolvedValue({
      object: {
        isMercadoLivrePromo: true,
        link: 'https://www.mercadolivre.com.br/produto/p/MLB123',
        coupon: 'PROMO10',
        discountedPrice: 89.9,
      },
    });

    const result = await extractPromo(
      'Fone Bluetooth XYZ\nDe R$149,90 por R$99,90\nCupom: PROMO10\nhttps://www.mercadolivre.com.br/produto/p/MLB123',
    );

    expect(result).toEqual({
      isMercadoLivrePromo: true,
      link: 'https://www.mercadolivre.com.br/produto/p/MLB123',
      coupon: 'PROMO10',
      discountedPrice: 89.9,
    });
    expect(generateObjectMock).toHaveBeenCalledWith(
      expect.objectContaining({
        model: expect.any(String),
        prompt: expect.stringContaining('Fone Bluetooth XYZ'),
      }),
    );
  });

  it('extrai promo sem cupom (coupon e discountedPrice nulos)', async () => {
    generateObjectMock.mockResolvedValue({
      object: {
        isMercadoLivrePromo: true,
        link: 'https://www.mercadolivre.com.br/produto/p/MLB999',
        coupon: null,
        discountedPrice: null,
      },
    });

    const result = await extractPromo('Produto legal https://www.mercadolivre.com.br/produto/p/MLB999');

    expect(result.coupon).toBeNull();
    expect(result.discountedPrice).toBeNull();
  });

  it('retorna isMercadoLivrePromo false pra mensagem que não é promo do Mercado Livre', async () => {
    generateObjectMock.mockResolvedValue({
      object: { isMercadoLivrePromo: false, link: null, coupon: null, discountedPrice: null },
    });

    const result = await extractPromo('Bom dia pessoal, tudo certo?');

    expect(result.isMercadoLivrePromo).toBe(false);
  });
});
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

Run: `npx vitest run src/lib/telegram/extractPromo.test.ts`
Expected: FAIL — `Cannot find module './extractPromo'`.

- [ ] **Step 3: Implementar `extractPromo`**

Create `src/lib/telegram/extractPromo.ts`:

```ts
import { generateObject } from 'ai';
import { z } from 'zod';

const PromoSchema = z.object({
  isMercadoLivrePromo: z.boolean(),
  link: z.string().nullable(),
  coupon: z.string().nullable(),
  discountedPrice: z.number().nullable(),
});

export interface PromoExtraction {
  isMercadoLivrePromo: boolean;
  link: string | null;
  coupon: string | null;
  discountedPrice: number | null;
}

const EXTRACTOR_MODEL = process.env.PROMO_EXTRACTOR_MODEL ?? 'openai/gpt-4o-mini';

const PROMPT_INSTRUCTIONS = `Você recebe o texto de uma mensagem de um grupo de promoções de compras online.

Decida se a mensagem é uma promoção de um produto do Mercado Livre (mercadolivre.com.br ou mercadolibre.com, incluindo links de encurtador/rastreador que podem levar pra lá — nesse caso ainda assim considere como possível promo do Mercado Livre e devolva o link como veio na mensagem).

Se for uma promoção do Mercado Livre, extraia:
- link: a URL do produto (ou do encurtador) exatamente como aparece na mensagem.
- coupon: o código do cupom de desconto, se a mensagem mencionar um. Caso contrário, null.
- discountedPrice: o preço final já com o cupom aplicado (o valor "por", não o valor "de"), como número (ex: 89.90). Se a mensagem não mencionar cupom ou não deixar claro o preço com desconto, use null.

Se a mensagem não for sobre uma promoção do Mercado Livre (ex: é conversa comum, ou é promoção de outro site/marketplace), retorne isMercadoLivrePromo: false e os demais campos null.`;

export async function extractPromo(messageText: string): Promise<PromoExtraction> {
  const { object } = await generateObject({
    model: EXTRACTOR_MODEL,
    schema: PromoSchema,
    prompt: `${PROMPT_INSTRUCTIONS}\n\nMensagem:\n"""\n${messageText}\n"""`,
  });
  return object;
}
```

- [ ] **Step 4: Rodar o teste e confirmar que passa**

Run: `npx vitest run src/lib/telegram/extractPromo.test.ts`
Expected: PASS (3 testes).

- [ ] **Step 5: Commit**

```bash
git add src/lib/telegram/extractPromo.ts src/lib/telegram/extractPromo.test.ts
git commit -m "feat: extrair link/cupom/preço de mensagem de promo via LLM"
```

---

### Task 4: `template.ts` + `pipeline.ts` — suporte a cupom e preço "de/por"

**Files:**
- Modify: `src/lib/content/template.ts`
- Modify: `src/lib/content/template.test.ts`
- Modify: `src/lib/pipeline.ts`
- Modify: `src/lib/pipeline.test.ts`

**Interfaces:**
- Consumes: `Product` de `src/lib/mercadolivre/affiliateLink.ts` (inalterado).
- Produces: `buildPostText(product: Product, affiliateLink: string, coupon?: string, discountedPrice?: number): string` — assinatura estendida, retrocompatível (chamada com só os 2 primeiros argumentos continua funcionando idêntico a hoje). `runPipeline(link: string, deps: PipelineDeps, options?: { coupon?: string; discountedPrice?: number }): Promise<PipelineResult>` — mesma retrocompatibilidade.

**Este é código já existente e aprovado em produção — mudanças são só as descritas abaixo, não reescreva o resto.**

- [ ] **Step 1: Escrever os testes novos que falham primeiro**

Modify `src/lib/content/template.test.ts` — adicione ao final do arquivo, antes do último `});` de fechamento do `describe`, estes dois casos nomeados (mantenha os 3 testes já existentes intactos):

```ts
  it('monta o HTML com preço de/por riscado e cupom quando discountedPrice é informado', () => {
    const text = buildPostText(
      { title: 'Fone de Ouvido Bluetooth XYZ', price: 149.9, imageUrl: 'https://x.com/img.jpg' },
      'https://meli.la/abc123',
      'PROMO10',
      89.9,
    );
    expect(text).toBe(
      'Fone de Ouvido Bluetooth XYZ de <s>R$149,90</s> por <strong>R$89,90</strong> com o cupom <strong>PROMO10</strong> — confira: <a href="https://meli.la/abc123">https://meli.la/abc123</a>',
    );
  });

  it('monta preço de/por sem cupom quando discountedPrice vem sem coupon', () => {
    const text = buildPostText(
      { title: 'Produto X', price: 200, imageUrl: 'https://x.com/img.jpg' },
      'https://meli.la/xyz',
      undefined,
      150,
    );
    expect(text).toBe(
      'Produto X de <s>R$200,00</s> por <strong>R$150,00</strong> — confira: <a href="https://meli.la/xyz">https://meli.la/xyz</a>',
    );
  });
```

Modify `src/lib/pipeline.test.ts` — adicione este teste dentro do `describe('runPipeline', ...)`, mantendo todos os testes já existentes intactos:

```ts
  it('repassa coupon e discountedPrice pro buildPostText quando informados nas options', async () => {
    const deps = makeDeps();

    await runPipeline('https://mercadolivre.com.br/MLB123', deps, {
      coupon: 'PROMO10',
      discountedPrice: 79.9,
    });

    expect(deps.buildPostText).toHaveBeenCalledWith(
      { title: 'Produto X', price: 99.9, imageUrl: 'https://x.com/img.jpg' },
      'https://meli.la/abc',
      'PROMO10',
      79.9,
    );
  });

  it('chama buildPostText sem coupon/discountedPrice quando options não é passado (comportamento atual)', async () => {
    const deps = makeDeps();

    await runPipeline('https://mercadolivre.com.br/MLB123', deps);

    expect(deps.buildPostText).toHaveBeenCalledWith(
      { title: 'Produto X', price: 99.9, imageUrl: 'https://x.com/img.jpg' },
      'https://meli.la/abc',
      undefined,
      undefined,
    );
  });
```

- [ ] **Step 2: Rodar os testes e confirmar que os novos falham**

Run: `npx vitest run src/lib/content/template.test.ts src/lib/pipeline.test.ts`
Expected: os 5 testes já existentes (3 em template, os antigos de pipeline) continuam passando; os 4 novos testes FALHAM (assinatura atual não aceita os argumentos extras / não repassa nada).

- [ ] **Step 3: Estender `buildPostText`**

In `src/lib/content/template.ts`, replace the whole file content with:

```ts
import type { Product } from '../mercadolivre/affiliateLink';

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function formatPrice(value: number): string {
  return value.toLocaleString('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function buildPostText(
  product: Product,
  affiliateLink: string,
  coupon?: string,
  discountedPrice?: number,
): string {
  const safeTitle = escapeHtml(product.title);
  const safeLink = escapeHtml(affiliateLink);

  if (discountedPrice !== undefined) {
    const regularPrice = formatPrice(product.price);
    const discounted = formatPrice(discountedPrice);
    const couponText = coupon ? ` com o cupom <strong>${escapeHtml(coupon)}</strong>` : '';
    return `${safeTitle} de <s>R$${regularPrice}</s> por <strong>R$${discounted}</strong>${couponText} — confira: <a href="${safeLink}">${safeLink}</a>`;
  }

  const price = formatPrice(product.price);
  return `${safeTitle} por <strong>R$${price}</strong> — confira: <a href="${safeLink}">${safeLink}</a>`;
}
```

- [ ] **Step 4: Estender `runPipeline`**

In `src/lib/pipeline.ts`, find the `runPipeline` function signature and its call to `deps.buildPostText`. Change:

```ts
export async function runPipeline(link: string, deps: PipelineDeps): Promise<PipelineResult> {
```
to:
```ts
export interface PipelineOptions {
  coupon?: string;
  discountedPrice?: number;
}

export async function runPipeline(
  link: string,
  deps: PipelineDeps,
  options?: PipelineOptions,
): Promise<PipelineResult> {
```

And change:
```ts
  const body = deps.buildPostText(product, affiliateLink);
```
to:
```ts
  const body = deps.buildPostText(product, affiliateLink, options?.coupon, options?.discountedPrice);
```

Also update the `PipelineDeps` interface's `buildPostText` field type to match the new signature:
```ts
  buildPostText: (product: Product, affiliateLink: string, coupon?: string, discountedPrice?: number) => string;
```

- [ ] **Step 5: Rodar os testes e confirmar que passam**

Run: `npx vitest run src/lib/content/template.test.ts src/lib/pipeline.test.ts`
Expected: PASS (5 + 4 = 9 testes: template com 5, pipeline com o total já existente + 2 novos).

- [ ] **Step 6: Rodar a suíte inteira e o typecheck**

Run: `npm test && npm run typecheck`
Expected: tudo verde, nenhuma regressão nas tasks já existentes.

- [ ] **Step 7: Commit**

```bash
git add src/lib/content/template.ts src/lib/content/template.test.ts src/lib/pipeline.ts src/lib/pipeline.test.ts
git commit -m "feat: suporte a cupom e preço de/por no texto do post"
```

---

### Task 5: Webhook `route.ts` — aceitar `coupon` e `discountedPrice`

**Files:**
- Modify: `src/app/api/webhook/route.ts`
- Modify: `src/app/api/webhook/route.test.ts`

**Interfaces:**
- Consumes: `runPipeline(link, deps, options?)` de `src/lib/pipeline.ts` (Task 4).
- Produces: nenhuma mudança de exportação — só o corpo aceito pelo `POST` handler muda.

- [ ] **Step 1: Escrever o teste que falha primeiro**

Modify `src/app/api/webhook/route.test.ts` — adicione este teste dentro do `describe('POST /api/webhook', ...)`, mantendo todos os testes existentes intactos:

```ts
  it('repassa coupon e discountedPrice do body pro runPipeline quando informados', async () => {
    vi.stubEnv('WEBHOOK_SECRET', 'correct-secret');
    vi.mocked(parseItemId).mockReturnValue('https://mercadolivre.com.br/MLB123');
    vi.mocked(fetchProductAndAffiliateLink).mockResolvedValue({
      product: { title: 'Produto X', price: 99.9, imageUrl: 'https://x.com/img.jpg' },
      affiliateLink: 'https://meli.la/abc',
    });
    vi.mocked(buildPostText).mockReturnValue('texto do post');
    vi.mocked(publishArticle).mockResolvedValue({
      url: 'https://loja.myshopify.com/blogs/noticias/produto-x',
    });

    await POST(
      makeRequest({
        link: 'https://mercadolivre.com.br/MLB123',
        coupon: 'PROMO10',
        discountedPrice: 79.9,
      }),
    );

    expect(buildPostText).toHaveBeenCalledWith(
      { title: 'Produto X', price: 99.9, imageUrl: 'https://x.com/img.jpg' },
      'https://meli.la/abc',
      'PROMO10',
      79.9,
    );
  });
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

Run: `npx vitest run src/app/api/webhook/route.test.ts`
Expected: FAIL — `buildPostText` é chamado sem os argumentos `coupon`/`discountedPrice` (a rota ainda não os lê nem repassa).

- [ ] **Step 3: Atualizar a rota**

In `src/app/api/webhook/route.ts`, change the `body` type declaration and the `runPipeline` call. Find:

```ts
  let body: { link?: string };
```
change to:
```ts
  let body: { link?: string; coupon?: string; discountedPrice?: number };
```

Find:
```ts
    const result = await runPipeline(body.link, {
      parseItemId,
      fetchProductAndAffiliateLink,
      buildPostText,
      publishArticle,
    });
```
change to:
```ts
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
```

- [ ] **Step 4: Rodar o teste e confirmar que passa**

Run: `npx vitest run src/app/api/webhook/route.test.ts`
Expected: PASS (todos os testes existentes + o novo).

- [ ] **Step 5: Rodar a suíte inteira e o typecheck**

Run: `npm test && npm run typecheck`
Expected: tudo verde.

- [ ] **Step 6: Commit**

```bash
git add src/app/api/webhook/route.ts src/app/api/webhook/route.test.ts
git commit -m "feat: aceitar coupon e discountedPrice no corpo do webhook"
```

---

### Task 6: Poller — orquestração (`pollTelegram`)

**Files:**
- Create: `src/lib/telegram/poller.ts`
- Test: `src/lib/telegram/poller.test.ts`

**Interfaces:**
- Consumes: nenhuma dependência concreta — tudo é injetado via `PollerDeps` (o mesmo padrão de injeção de dependência usado em `pipeline.ts`).
- Produces: `interface TelegramMessage { id: number; text: string }`, `interface PollerDeps { fetchNewMessages, loadCursor, saveCursor, extractPromo, callWebhook, batchLimit? }`, `interface PollResult { processedCount: number; promoCount: number; errors: Array<{ messageId: number; error: string }> }`, `async function pollTelegram(deps: PollerDeps): Promise<PollResult>` — todas exportadas de `src/lib/telegram/poller.ts`. Task 7 monta a implementação real de cada campo de `PollerDeps` (GramJS de verdade, cursor/extractor/webhook reais) e chama `pollTelegram`.

- [ ] **Step 1: Escrever o teste que falha primeiro**

Create `src/lib/telegram/poller.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { pollTelegram, type PollerDeps } from './poller';

function makeDeps(overrides: Partial<PollerDeps> = {}): PollerDeps {
  return {
    fetchNewMessages: vi.fn().mockResolvedValue([]),
    loadCursor: vi.fn().mockResolvedValue(null),
    saveCursor: vi.fn().mockResolvedValue(undefined),
    extractPromo: vi.fn().mockResolvedValue({
      isMercadoLivrePromo: false,
      link: null,
      coupon: null,
      discountedPrice: null,
    }),
    callWebhook: vi.fn().mockResolvedValue({ ok: true, status: 200 }),
    ...overrides,
  };
}

describe('pollTelegram', () => {
  it('não processa nada quando não há mensagens novas', async () => {
    const deps = makeDeps();

    const result = await pollTelegram(deps);

    expect(result).toEqual({ processedCount: 0, promoCount: 0, errors: [] });
    expect(deps.saveCursor).not.toHaveBeenCalled();
  });

  it('ignora mensagem que não é promo do Mercado Livre, mas avança o cursor', async () => {
    const deps = makeDeps({
      fetchNewMessages: vi.fn().mockResolvedValue([{ id: 10, text: 'bom dia pessoal' }]),
    });

    const result = await pollTelegram(deps);

    expect(result.promoCount).toBe(0);
    expect(result.processedCount).toBe(1);
    expect(deps.callWebhook).not.toHaveBeenCalled();
    expect(deps.saveCursor).toHaveBeenCalledWith(10);
  });

  it('chama o webhook e conta como promo quando a mensagem é reconhecida', async () => {
    const deps = makeDeps({
      fetchNewMessages: vi.fn().mockResolvedValue([{ id: 11, text: 'promo boa' }]),
      extractPromo: vi.fn().mockResolvedValue({
        isMercadoLivrePromo: true,
        link: 'https://www.mercadolivre.com.br/produto/p/MLB1',
        coupon: 'PROMO10',
        discountedPrice: 79.9,
      }),
    });

    const result = await pollTelegram(deps);

    expect(result.promoCount).toBe(1);
    expect(deps.callWebhook).toHaveBeenCalledWith({
      link: 'https://www.mercadolivre.com.br/produto/p/MLB1',
      coupon: 'PROMO10',
      discountedPrice: 79.9,
    });
    expect(deps.saveCursor).toHaveBeenCalledWith(11);
  });

  it('registra erro e avança o cursor mesmo assim quando a extração falha', async () => {
    const deps = makeDeps({
      fetchNewMessages: vi.fn().mockResolvedValue([{ id: 12, text: 'x' }]),
      extractPromo: vi.fn().mockRejectedValue(new Error('LLM indisponível')),
    });

    const result = await pollTelegram(deps);

    expect(result.errors).toEqual([{ messageId: 12, error: 'Falha na extração: LLM indisponível' }]);
    expect(deps.saveCursor).toHaveBeenCalledWith(12);
  });

  it('registra erro e avança o cursor mesmo assim quando o webhook falha', async () => {
    const deps = makeDeps({
      fetchNewMessages: vi.fn().mockResolvedValue([{ id: 13, text: 'promo' }]),
      extractPromo: vi.fn().mockResolvedValue({
        isMercadoLivrePromo: true,
        link: 'https://www.mercadolivre.com.br/produto/p/MLB2',
        coupon: null,
        discountedPrice: null,
      }),
      callWebhook: vi.fn().mockResolvedValue({ ok: false, status: 502 }),
    });

    const result = await pollTelegram(deps);

    expect(result.promoCount).toBe(0);
    expect(result.errors).toEqual([{ messageId: 13, error: 'Webhook retornou status 502' }]);
    expect(deps.saveCursor).toHaveBeenCalledWith(13);
  });

  it('respeita o batchLimit, processando só as primeiras N mensagens', async () => {
    const messages = [1, 2, 3].map((id) => ({ id, text: `msg ${id}` }));
    const deps = makeDeps({
      fetchNewMessages: vi.fn().mockResolvedValue(messages),
      batchLimit: 2,
    });

    const result = await pollTelegram(deps);

    expect(result.processedCount).toBe(2);
    expect(deps.saveCursor).toHaveBeenCalledTimes(2);
  });

  it('passa o cursor carregado como afterId pro fetchNewMessages', async () => {
    const deps = makeDeps({ loadCursor: vi.fn().mockResolvedValue(999) });

    await pollTelegram(deps);

    expect(deps.fetchNewMessages).toHaveBeenCalledWith(999);
  });
});
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

Run: `npx vitest run src/lib/telegram/poller.test.ts`
Expected: FAIL — `Cannot find module './poller'`.

- [ ] **Step 3: Implementar `pollTelegram`**

Create `src/lib/telegram/poller.ts`:

```ts
export interface TelegramMessage {
  id: number;
  text: string;
}

export interface PromoExtractionResult {
  isMercadoLivrePromo: boolean;
  link: string | null;
  coupon: string | null;
  discountedPrice: number | null;
}

export interface WebhookCallResult {
  ok: boolean;
  status: number;
}

export interface PollerDeps {
  fetchNewMessages: (afterId: number | null) => Promise<TelegramMessage[]>;
  loadCursor: () => Promise<number | null>;
  saveCursor: (messageId: number) => Promise<void>;
  extractPromo: (text: string) => Promise<PromoExtractionResult>;
  callWebhook: (body: {
    link: string;
    coupon?: string;
    discountedPrice?: number;
  }) => Promise<WebhookCallResult>;
  batchLimit?: number;
}

export interface PollResult {
  processedCount: number;
  promoCount: number;
  errors: Array<{ messageId: number; error: string }>;
}

const DEFAULT_BATCH_LIMIT = 5;

export async function pollTelegram(deps: PollerDeps): Promise<PollResult> {
  const cursor = await deps.loadCursor();
  const allMessages = await deps.fetchNewMessages(cursor);
  const batchLimit = deps.batchLimit ?? DEFAULT_BATCH_LIMIT;
  const messages = allMessages.slice(0, batchLimit);

  let promoCount = 0;
  const errors: Array<{ messageId: number; error: string }> = [];

  for (const message of messages) {
    let extraction: PromoExtractionResult;
    try {
      extraction = await deps.extractPromo(message.text);
    } catch (err) {
      errors.push({ messageId: message.id, error: `Falha na extração: ${(err as Error).message}` });
      await deps.saveCursor(message.id);
      continue;
    }

    if (!extraction.isMercadoLivrePromo || !extraction.link) {
      await deps.saveCursor(message.id);
      continue;
    }

    try {
      const result = await deps.callWebhook({
        link: extraction.link,
        coupon: extraction.coupon ?? undefined,
        discountedPrice: extraction.discountedPrice ?? undefined,
      });
      if (result.ok) {
        promoCount += 1;
      } else {
        errors.push({ messageId: message.id, error: `Webhook retornou status ${result.status}` });
      }
    } catch (err) {
      errors.push({ messageId: message.id, error: `Falha ao chamar webhook: ${(err as Error).message}` });
    }

    await deps.saveCursor(message.id);
  }

  return { processedCount: messages.length, promoCount, errors };
}
```

- [ ] **Step 4: Rodar o teste e confirmar que passa**

Run: `npx vitest run src/lib/telegram/poller.test.ts`
Expected: PASS (7 testes).

- [ ] **Step 5: Commit**

```bash
git add src/lib/telegram/poller.ts src/lib/telegram/poller.test.ts
git commit -m "feat: orquestração do poller Telegram (sem retry, avança cursor sempre)"
```

---

### Task 7: Rota do Cron (`/api/telegram-poll`) — wiring real do GramJS

**Files:**
- Create: `src/app/api/telegram-poll/route.ts`

**Interfaces:**
- Consumes: `pollTelegram`, `PollerDeps`, `TelegramMessage` de `src/lib/telegram/poller.ts` (Task 6); `loadSession` de `src/lib/telegram/sessionStore.ts` (Task 1); `loadCursor`/`saveCursor` de `src/lib/telegram/cursorStore.ts` (Task 2); `extractPromo` de `src/lib/telegram/extractPromo.ts` (Task 3).
- Produces: handler `GET(request: Request): Promise<Response>` no App Router.

**Nota importante:** este arquivo faz o wiring real com a biblioteca GramJS (`telegram`), que exige uma conexão de rede real ao Telegram — não é testável por unidade (mesma categoria de `generate-link.playwright.mjs`, que também não tem teste automatizado por depender de uma sessão real). A API exata do GramJS usada abaixo (`client.getEntity`, parâmetros de `client.getMessages`, o campo `m.message` como texto da mensagem) foi escrita a partir da documentação da biblioteca, mas **precisa ser confirmada rodando de verdade** — assim como os seletores do Playwright do Mercado Livre precisaram de ajuste ao testar contra o site real (ver `docs/runbook.md`), esta rota deve ser validada manualmente (Task 9/10) e corrigida se algum nome de método/campo estiver diferente do esperado.

- [ ] **Step 1: Criar a rota**

Create `src/app/api/telegram-poll/route.ts`:

```ts
import { TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions/index.js';
import { extractPromo } from '@/lib/telegram/extractPromo';
import { loadCursor, saveCursor } from '@/lib/telegram/cursorStore';
import { loadSession } from '@/lib/telegram/sessionStore';
import { pollTelegram, type TelegramMessage } from '@/lib/telegram/poller';

export const maxDuration = 300;

async function fetchNewMessages(afterId: number | null): Promise<TelegramMessage[]> {
  const sessionString = await loadSession();
  const apiId = Number(process.env.TELEGRAM_API_ID);
  const apiHash = process.env.TELEGRAM_API_HASH;
  const chatId = process.env.TELEGRAM_TARGET_CHAT_ID;

  if (!apiId || !apiHash) {
    throw new Error('TELEGRAM_API_ID / TELEGRAM_API_HASH não configurados');
  }
  if (!chatId) {
    throw new Error('TELEGRAM_TARGET_CHAT_ID não configurado');
  }

  const client = new TelegramClient(new StringSession(sessionString), apiId, apiHash, {
    connectionRetries: 3,
  });
  await client.connect();

  try {
    const entity = await client.getEntity(chatId);
    const rawMessages = await client.getMessages(entity, {
      limit: 20,
      minId: afterId ?? 0,
      reverse: true,
    });

    return rawMessages
      .filter((m: { message?: unknown; id: number }) => typeof m.message === 'string' && m.message.trim().length > 0)
      .map((m: { message: string; id: number }) => ({ id: m.id, text: m.message }));
  } finally {
    await client.disconnect();
  }
}

async function callWebhook(body: {
  link: string;
  coupon?: string;
  discountedPrice?: number;
}): Promise<{ ok: boolean; status: number }> {
  const baseUrl = process.env.WEBHOOK_BASE_URL;
  const secret = process.env.WEBHOOK_SECRET;
  if (!baseUrl || !secret) {
    throw new Error('WEBHOOK_BASE_URL / WEBHOOK_SECRET não configurados');
  }

  const res = await fetch(`${baseUrl}/api/webhook`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-promopost-secret': secret,
    },
    body: JSON.stringify(body),
  });

  return { ok: res.ok, status: res.status };
}

export async function GET(request: Request): Promise<Response> {
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return Response.json({ erro: 'não autorizado' }, { status: 401 });
  }

  try {
    const result = await pollTelegram({
      fetchNewMessages,
      loadCursor,
      saveCursor,
      extractPromo,
      callWebhook,
    });
    return Response.json(result, { status: 200 });
  } catch (err) {
    console.error('Erro no poller do Telegram:', err);
    return Response.json({ erro: (err as Error).message }, { status: 500 });
  }
}
```

- [ ] **Step 2: Rodar o typecheck**

Run: `npm run typecheck`
Expected: sem erro. Se a biblioteca `telegram` expuser tipos diferentes dos usados aqui (ex: `client.getMessages` com assinatura diferente), corrija os tipos conforme o `.d.ts` real do pacote instalado em `node_modules/telegram` antes de prosseguir.

- [ ] **Step 3: Rodar a suíte inteira**

Run: `npm test`
Expected: PASS — esta rota não tem teste próprio (ver nota acima), mas nenhuma das tasks anteriores deve quebrar.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/telegram-poll/route.ts
git commit -m "feat: rota do cron do Telegram (wiring real GramJS, requer validação manual)"
```

---

### Task 8: Configuração do Cron (`vercel.ts`)

**Files:**
- Create: `vercel.ts`

**Interfaces:** nenhuma — configuração de plataforma, sem código de aplicação.

- [ ] **Step 1: Criar `vercel.ts`**

Create `vercel.ts`:

```ts
import type { VercelConfig } from '@vercel/config/v1';

export const config: VercelConfig = {
  crons: [{ path: '/api/telegram-poll', schedule: '*/3 * * * *' }],
};
```

- [ ] **Step 2: Rodar o typecheck**

Run: `npm run typecheck`
Expected: sem erro. Se `@vercel/config` não exportar `VercelConfig` em `@vercel/config/v1` na versão instalada, ajuste o caminho de import conforme a documentação do pacote instalado.

- [ ] **Step 3: Commit**

```bash
git add vercel.ts
git commit -m "feat: agendar cron do poller Telegram a cada 3 minutos"
```

---

### Task 9: Script de bootstrap da sessão Telegram (manual, local)

**Files:**
- Create: `scripts/bootstrap-telegram-session.mjs`

**Interfaces:** nenhuma exportação — script standalone executado manualmente.

**Por que sem teste automatizado:** este script faz login interativo numa conta Telegram real (telefone + código SMS + senha de duas etapas) — não há o que testar por unidade, mesma categoria do `bootstrap-session.mjs` do Mercado Livre.

- [ ] **Step 1: Adicionar dependência `input`**

No `package.json`, adicione ao `dependencies`:
```json
"input": "^1.0.1"
```

Run: `npm install`

- [ ] **Step 2: Criar o script**

Create `scripts/bootstrap-telegram-session.mjs`:

```js
#!/usr/bin/env node
// Rodar localmente UMA VEZ (ou sempre que a sessão do Telegram expirar):
//   TELEGRAM_API_ID=xxx TELEGRAM_API_HASH=xxx BLOB_READ_WRITE_TOKEN=xxx node scripts/bootstrap-telegram-session.mjs
//
// TELEGRAM_API_ID e TELEGRAM_API_HASH vêm de https://my.telegram.org (Apps).
//
// Loga interativamente (telefone + código SMS + senha de duas etapas, se
// houver) usando a API oficial de cliente do Telegram (GramJS/MTProto) —
// use uma conta secundária dedicada, não sua conta pessoal principal.
// Salva a sessão resultante no Vercel Blob e lista os chats (dialogs) da
// conta pra você identificar o ID do grupo/canal alvo.

import { TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions/index.js';
import input from 'input';
import { put } from '@vercel/blob';

async function main() {
  const apiId = Number(process.env.TELEGRAM_API_ID);
  const apiHash = process.env.TELEGRAM_API_HASH;
  if (!apiId || !apiHash) {
    console.error(
      'Defina TELEGRAM_API_ID e TELEGRAM_API_HASH antes de rodar (pegue em https://my.telegram.org).',
    );
    process.exit(1);
  }
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    console.error('Defina BLOB_READ_WRITE_TOKEN antes de rodar este script.');
    process.exit(1);
  }

  const client = new TelegramClient(new StringSession(''), apiId, apiHash, {
    connectionRetries: 5,
  });

  await client.start({
    phoneNumber: async () =>
      await input.text('Número de telefone (com código do país, ex: +5511999999999): '),
    password: async () =>
      await input.text('Senha de verificação em duas etapas (deixe em branco se não tiver): '),
    phoneCode: async () => await input.text('Código recebido por SMS/Telegram: '),
    onError: (err) => console.error(err),
  });

  const sessionString = client.session.save();

  const blob = await put('telegram-session.txt', sessionString, {
    access: 'private',
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: 'text/plain',
    token: process.env.BLOB_READ_WRITE_TOKEN,
  });

  console.log('\nSessão salva.');
  console.log('Configure na Vercel: TELEGRAM_SESSION_BLOB_URL =', blob.url);

  console.log('\nChats desta conta (pra identificar o ID do grupo/canal alvo):');
  const dialogs = await client.getDialogs({ limit: 50 });
  for (const dialog of dialogs) {
    console.log(`  ${dialog.id} — ${dialog.title ?? dialog.name ?? '(sem título)'}`);
  }
  console.log('\nConfigure na Vercel: TELEGRAM_TARGET_CHAT_ID = <ID do chat listado acima>');

  await client.disconnect();
}

main();
```

- [ ] **Step 3: Validação manual**

Run: `TELEGRAM_API_ID=<id> TELEGRAM_API_HASH=<hash> BLOB_READ_WRITE_TOKEN=<token> node scripts/bootstrap-telegram-session.mjs`
Expected: pede telefone, código, (senha 2FA se houver), imprime `Sessão salva.` com a URL, e lista os chats com seus IDs. Se algum método do GramJS usado aqui não existir/tiver nome diferente na versão instalada (ver nota da Task 7), corrija aqui e na Task 7 juntos.

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json scripts/bootstrap-telegram-session.mjs
git commit -m "feat: script de bootstrap manual da sessao Telegram"
```

---

### Task 10: Runbook + `.env.example` — passo a passo Telegram

**Files:**
- Modify: `.env.example`
- Modify: `docs/runbook.md`

**Interfaces:** nenhuma — documentação e configuração, sem código de produção.

- [ ] **Step 1: Adicionar as novas env vars ao `.env.example`**

In `.env.example`, append at the end:

```
# Credenciais de app do Telegram (my.telegram.org > API Development Tools)
TELEGRAM_API_ID=
TELEGRAM_API_HASH=

# URL do blob privado com a sessão da conta Telegram (gerado por
# scripts/bootstrap-telegram-session.mjs)
TELEGRAM_SESSION_BLOB_URL=

# ID do chat (grupo/canal) do Telegram a monitorar — listado pelo script de bootstrap
TELEGRAM_TARGET_CHAT_ID=

# Segredo que a Vercel envia automaticamente pro endpoint de cron (Project Settings > Cron Jobs)
CRON_SECRET=

# URL base pública do próprio projeto, usada pelo poller pra chamar seu próprio webhook
WEBHOOK_BASE_URL=https://promopost.vercel.app

# Modelo usado pra extrair dado de promoção via Vercel AI Gateway (opcional, tem default no código)
PROMO_EXTRACTOR_MODEL=openai/gpt-4o-mini
```

- [ ] **Step 2: Adicionar seção ao runbook**

In `docs/runbook.md`, append a new section at the end of the file (after the existing "8. Se algo falhar" section):

```markdown

## 9. Gatilho Telegram (opcional, sub-projeto separado)

Cobre a captura automática de promoção do Mercado Livre a partir de um grupo/canal do Telegram (ver `docs/superpowers/specs/2026-07-28-telegram-trigger-design.md`).

### 9.1 Credenciais do app Telegram

Acesse https://my.telegram.org, faça login com o número da **conta secundária** que vai rodar a automação, vá em "API Development Tools" e crie um app. Anote `api_id` e `api_hash` — vão em `TELEGRAM_API_ID`/`TELEGRAM_API_HASH`.

### 9.2 Bootstrap da sessão + descoberta do chat alvo

```bash
TELEGRAM_API_ID=<id> TELEGRAM_API_HASH=<hash> BLOB_READ_WRITE_TOKEN=<token> node scripts/bootstrap-telegram-session.mjs
```

Loga com telefone + código recebido (+ senha de duas etapas, se a conta tiver). Ao final, o script imprime a URL da sessão salva (`TELEGRAM_SESSION_BLOB_URL`) e a lista de chats da conta com seus IDs — identifique o grupo/canal de promoções na lista e anote o ID (`TELEGRAM_TARGET_CHAT_ID`).

### 9.3 Configurar variáveis de ambiente na Vercel

Além das que já existem (seção 1), configure: `TELEGRAM_API_ID`, `TELEGRAM_API_HASH`, `TELEGRAM_SESSION_BLOB_URL`, `TELEGRAM_TARGET_CHAT_ID`, `WEBHOOK_BASE_URL` (domínio de produção, ex: `https://promopost.vercel.app`), `CRON_SECRET` (Vercel gera automaticamente esse valor e envia no header da chamada do cron — configure o mesmo valor como env var do projeto).

### 9.4 Deploy e verificação do cron

Depois do deploy (`vercel deploy --prod`), confira em Project Settings > Cron Jobs se `/api/telegram-poll` aparece agendado a cada 3 minutos.

### 9.5 Teste manual

```bash
curl https://promopost.vercel.app/api/telegram-poll \
  -H "authorization: Bearer $CRON_SECRET"
```

Esperado: `200` com `{ "processedCount": N, "promoCount": N, "errors": [] }`. Mande uma mensagem de teste no grupo/canal de origem antes de rodar, no formato descrito no caso de uso original (nome do produto, de/por, cupom, link), e confira se um novo rascunho aparece no blog Shopify depois.

### 9.6 Se algo falhar

- Erro de conexão/autenticação do Telegram na rota do cron — a sessão pode ter expirado; repita o passo 9.2.
- `processedCount: 0` mesmo com mensagem nova no grupo — confira se `TELEGRAM_TARGET_CHAT_ID` é o chat certo, e se a API do GramJS usada em `src/app/api/telegram-poll/route.ts` bate com a versão instalada (ver nota na Task 7 do plano de implementação) — pode precisar ajustar nomes de método/campo depois de testar contra a conta real.
- Mensagem processada mas sem post gerado — confira o campo `errors` da resposta do cron; o texto ali indica se foi falha de extração (LLM) ou do webhook (mesma tabela de erros da seção 8).
```

- [ ] **Step 3: Commit**

```bash
git add .env.example docs/runbook.md
git commit -m "docs: passo a passo do gatilho Telegram no runbook"
```

---

## Self-Review

**Cobertura do spec:** captura via Telegram userbot (Task 1, 7, 9), cursor auto-inicializável (Task 2), extração via LLM link+cupom+preço com desconto (Task 3), preço "de/por" com cupom no post (Task 4), webhook estendido aditivamente (Task 5), orquestração sem retry com cursor sempre avançando (Task 6), agendamento via Vercel Cron (Task 8), documentação operacional completa (Task 10). Sem lacunas identificadas frente à spec.

**Placeholder scan:** nenhum "TBD"/"TODO" solto. A rota do cron (Task 7) e o script de bootstrap (Task 9) têm uma limitação real e documentada — a API exata do GramJS não pôde ser verificada sem rodar contra uma conta real —, não uma instrução vaga: vêm com código completo, best-effort baseado na documentação da biblioteca, e um passo explícito de validação manual com o que fazer se algo não bater (mesmo padrão já usado e já bem-sucedido para os seletores do Playwright do Mercado Livre neste mesmo projeto).

**Consistência de tipos:** `Product` inalterado. `buildPostText(product, affiliateLink, coupon?, discountedPrice?)` consistente entre `template.ts` (Task 4), `PipelineDeps` (Task 4) e a chamada em `runPipeline`. `PipelineOptions { coupon?, discountedPrice? }` consistente entre `pipeline.ts` (Task 4) e `route.ts` do webhook (Task 5). `TelegramMessage { id, text }` consistente entre `poller.ts` (Task 6) e a rota do cron (Task 7). `PromoExtraction`/`PromoExtractionResult` consistente entre `extractPromo.ts` (Task 3) e `poller.ts` (Task 6) — mesma forma, nomes de campo idênticos (`isMercadoLivrePromo`, `link`, `coupon`, `discountedPrice`). `PollerDeps` consistente entre a definição em `poller.ts` (Task 6) e o objeto montado na rota do cron (Task 7).
