# Publicar cupons "lista" do Mercado Livre Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Em vez de descartar mensagens de cupom de loja/categoria inteira do Mercado Livre (sem produto único, com link `/social/{handle}/lists`), publicar um post de cupom (com link de afiliado gerado pela nossa própria conta) em todos os canais já suportados.

**Architecture:** O script Playwright para de emitir `PRODUCT_LIST_LINK` como erro fatal — quando reconhece o padrão de lista, pula a extração de produto e reaproveita o gerador de link de afiliado do Mercado Livre (extraído pra uma função compartilhada) pra gerar um link próprio pra essa URL de lista, emitindo `{marketplace, affiliateLink, isListCoupon: true}`. `affiliateLink.ts` reconhece esse formato e lança `ListCouponError` (novo, ao lado das classes de erro já existentes em `pipeline.ts`), que `runPipeline` repassa sem embrulhar. O webhook captura esse erro especificamente e desvia pra um caminho de publicação de cupom: monta legenda e artigo a partir dos campos de desconto (capturados desde a extração via LLM), gera uma imagem genérica via nova rota `/api/coupon-image`, e publica nos mesmos cinco canais de sempre (Shopify, Facebook, Instagram feed+Story, TikTok, grupos do Telegram) reaproveitando os publishers já existentes sem modificá-los.

**Tech Stack:** Node.js, Playwright, Next.js (`next/og`), TypeScript, Vitest, `sharp` — nenhuma dependência nova.

## Global Constraints

- Escopo só Mercado Livre — Shopee/Amazon ficam de fora deste plano.
- Detecção do padrão de lista: `/\/social\/[^/]+\/lists\/?$/i` no pathname da URL resolvida (regex já existente, sem mudança).
- `extractPromo.ts` ganha 3 campos novos opcionais/`null`-áveis: `discountPercent`, `minPurchaseValue`, `maxDiscountValue` — best-effort a partir do texto da mensagem.
- O link de afiliado do cupom é gerado pela nossa própria conta (via `mercadolivre.com.br/afiliados/linkbuilder#hub`, reaproveitando o mesmo mecanismo já usado pro fluxo de produto), nunca reaproveitado do link que veio na mensagem original.
- Saída do script Playwright pro caso de cupom de lista: `{"marketplace":"mercadolivre","affiliateLink":"...","isListCoupon":true}` — sem `title`/`price`/`imageUrl` (não existem pra esse tipo de página).
- `ListCouponError` (novo, em `pipeline.ts`) carrega `affiliateLink: string`. `runPipeline` repassa esse erro sem embrulhar em `PipelineError` — o webhook o captura diretamente.
- Imagem de cupom: `/api/coupon-image`, dimensões **1080x1350** (proporção 4:5) — escolhida especificamente pra não cair no problema já conhecido de rejeição de proporção do feed do Instagram (visto na validação da Amazon), diferente do 1080x1920 (9:16) usado no Story de produto. Saída sempre convertida pra JPEG de verdade via `sharp` (não confiar só na extensão da URL) — mesmo motivo já documentado pro proxy do TikTok/Telegram: alguns consumidores (GramJS) decidem foto-vs-documento só pela extensão no fim da string da URL.
- Legenda/artigo do cupom não usam nenhum dado de `Product` — funções puras novas em `src/lib/content/couponTemplate.ts`.
- Publishers sociais (`postToFacebook`, `postToInstagram`, `postStoryToInstagram`, `postToTikTok`, `postToTelegramGroups`, `publishArticle`) não sofrem nenhuma mudança de assinatura — já são genéricos o bastante (recebem `imageUrl`/legenda/título como strings, nunca `Product` diretamente).

---

### Task 1: `extractPromo.ts` — campos novos de desconto

**Files:**
- Modify: `src/lib/telegram/extractPromo.ts`
- Modify: `src/lib/telegram/extractPromo.test.ts`

**Interfaces:**
- Produces (usado pela Task 2): `PromoExtraction` ganha `discountPercent: number | null`, `minPurchaseValue: number | null`, `maxDiscountValue: number | null`.

- [ ] **Step 1: Write the failing test**

Adicione ao final de `src/lib/telegram/extractPromo.test.ts` (mantendo os testes já existentes intactos):

```typescript
// src/lib/telegram/extractPromo.test.ts (adicionar ao final do describe já existente, antes do `});` de fechamento)
  it('extrai discountPercent, minPurchaseValue e maxDiscountValue de um cupom de loja/categoria inteira', async () => {
    generateObjectMock.mockResolvedValue({
      object: {
        isPromo: true,
        link: 'https://www.mercadolivre.com.br/social/promozonevip/lists',
        coupon: 'LIVROSJOGOSRELAMPAGO',
        discountedPrice: null,
        discountPercent: 20,
        minPurchaseValue: 59,
        maxDiscountValue: 30,
      },
    });

    const result = await extractPromo(
      'NOVO CUPOM MERCADOLIVRE\nLIVROSJOGOSRELAMPAGO 20% OFF em compras acima de R$ 59,00\nDesconto máximo de R$ 30\nAtive pelo link: http://www.mercadolivre.com.br/social/promozonevip/lists',
    );

    expect(result).toEqual({
      isPromo: true,
      link: 'https://www.mercadolivre.com.br/social/promozonevip/lists',
      coupon: 'LIVROSJOGOSRELAMPAGO',
      discountedPrice: null,
      discountPercent: 20,
      minPurchaseValue: 59,
      maxDiscountValue: 30,
    });
  });

  it('retorna discountPercent, minPurchaseValue e maxDiscountValue como null quando a mensagem não menciona esses valores', async () => {
    generateObjectMock.mockResolvedValue({
      object: {
        isPromo: true,
        link: 'https://www.mercadolivre.com.br/produto/p/MLB999',
        coupon: null,
        discountedPrice: null,
        discountPercent: null,
        minPurchaseValue: null,
        maxDiscountValue: null,
      },
    });

    const result = await extractPromo('Produto legal https://www.mercadolivre.com.br/produto/p/MLB999');

    expect(result.discountPercent).toBeNull();
    expect(result.minPurchaseValue).toBeNull();
    expect(result.maxDiscountValue).toBeNull();
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/telegram/extractPromo.test.ts`
Expected: FAIL — o `result` não vai ter `discountPercent`/`minPurchaseValue`/`maxDiscountValue` porque o schema/tipo ainda não os inclui (o mock já os retorna, mas `extractPromo` só repassa o que o schema Zod valida).

- [ ] **Step 3: Write the implementation**

Em `src/lib/telegram/extractPromo.ts`, troque o `PromoSchema` e a interface `PromoExtraction`:

```typescript
// src/lib/telegram/extractPromo.ts
const PromoSchema = z.object({
  isPromo: z.boolean(),
  link: z.string().nullable(),
  coupon: z.string().nullable(),
  discountedPrice: z.number().nullable(),
  discountPercent: z.number().nullable(),
  minPurchaseValue: z.number().nullable(),
  maxDiscountValue: z.number().nullable(),
});

export interface PromoExtraction {
  isPromo: boolean;
  link: string | null;
  coupon: string | null;
  discountedPrice: number | null;
  discountPercent: number | null;
  minPurchaseValue: number | null;
  maxDiscountValue: number | null;
}
```

Troque `PROMPT_INSTRUCTIONS` pra instruir a extração dos 3 campos novos (mantendo a estrutura e o texto já existente, só adicionando os 3 bullets novos e ajustando a frase de abertura da lista):

```typescript
// src/lib/telegram/extractPromo.ts
const PROMPT_INSTRUCTIONS = `Você recebe o texto de uma mensagem de um grupo de promoções de compras online.

Decida se a mensagem é uma promoção de um produto do Mercado Livre (mercadolivre.com.br ou mercadolibre.com), da Shopee (shopee.com.br) ou da Amazon (amazon.com.br), incluindo links de encurtador/rastreador que podem levar pra lá — nesse caso ainda assim considere como possível promo válida e devolva o link como veio na mensagem. Isso inclui cupons de loja ou categoria inteira do Mercado Livre (sem produto único vinculado, com um link pra página de listas do afiliado, ex: mercadolivre.com.br/social/{handle}/lists) — também são promoções válidas.

Se for uma promoção do Mercado Livre, da Shopee ou da Amazon, extraia:
- link: a URL do produto (ou do encurtador, ou da página de listas do afiliado no caso de cupom de loja/categoria inteira) exatamente como aparece na mensagem.
- coupon: o código do cupom de desconto, se a mensagem mencionar um. Caso contrário, null. Independente de haver preço com desconto ou não.
- discountedPrice: o preço final de venda mencionado na mensagem (o valor "por", não o valor "de"), como número (ex: 89.90) — sempre que a mensagem deixar claro esse valor, com ou sem cupom (pode ser um desconto direto, sem código nenhum). Se a mensagem não deixar claro um preço final específico, use null.
- discountPercent: o percentual de desconto do cupom (ex: "20% OFF" → 20), como número, quando a mensagem mencionar um desconto percentual. Se não houver percentual mencionado, use null.
- minPurchaseValue: o valor mínimo de compra pra o cupom valer (ex: "compras acima de R$59,00" → 59), como número. Se não houver valor mínimo mencionado, use null.
- maxDiscountValue: o valor máximo de desconto que o cupom concede (ex: "desconto máximo de R$30" → 30), como número. Se não houver valor máximo mencionado, use null.

Se a mensagem não for sobre uma promoção do Mercado Livre, da Shopee nem da Amazon (ex: é conversa comum, ou é promoção de outro site/marketplace), retorne isPromo: false e os demais campos null.`;
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/telegram/extractPromo.test.ts`
Expected: PASS (todos os testes, incluindo os 2 novos).

- [ ] **Step 5: Run the full test suite**

Run: `npx vitest run`
Expected: todos os testes passando.

- [ ] **Step 6: Commit**

```bash
git add src/lib/telegram/extractPromo.ts src/lib/telegram/extractPromo.test.ts
git commit -m "feat: extractPromo captura percentual, minimo e maximo de cupom"
```

---

### Task 2: Repassar os campos novos pelo poller e pela rota de cron

**Files:**
- Modify: `src/lib/telegram/poller.ts`
- Modify: `src/lib/telegram/poller.test.ts`
- Modify: `src/app/api/telegram-poll/route.ts`

**Interfaces:**
- Consumes (da Task 1): `PromoExtraction` com `discountPercent`, `minPurchaseValue`, `maxDiscountValue`.
- Produces (usado pela Task 7): `PollerDeps.callWebhook`'s body ganha `discountPercent?: number`, `minPurchaseValue?: number`, `maxDiscountValue?: number` — os mesmos 3 campos chegam no corpo de `POST /api/webhook`.

- [ ] **Step 1: Write the failing test**

Adicione ao final de `src/lib/telegram/poller.test.ts` (mantendo os testes já existentes intactos):

```typescript
// src/lib/telegram/poller.test.ts (adicionar ao final do describe já existente, antes do `});` de fechamento)
  it('repassa discountPercent, minPurchaseValue e maxDiscountValue pro callWebhook quando presentes', async () => {
    const deps = makeDeps({
      fetchNewMessages: vi.fn().mockResolvedValue([{ id: 12, text: 'cupom de lista' }]),
      extractPromo: vi.fn().mockResolvedValue({
        isPromo: true,
        link: 'https://www.mercadolivre.com.br/social/promozonevip/lists',
        coupon: 'LIVROSJOGOSRELAMPAGO',
        discountedPrice: null,
        discountPercent: 20,
        minPurchaseValue: 59,
        maxDiscountValue: 30,
      }),
    });

    await pollTelegram(deps);

    expect(deps.callWebhook).toHaveBeenCalledWith({
      link: 'https://www.mercadolivre.com.br/social/promozonevip/lists',
      coupon: 'LIVROSJOGOSRELAMPAGO',
      discountedPrice: undefined,
      discountPercent: 20,
      minPurchaseValue: 59,
      maxDiscountValue: 30,
    });
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/telegram/poller.test.ts`
Expected: FAIL — o objeto passado pra `callWebhook` ainda não inclui `discountPercent`/`minPurchaseValue`/`maxDiscountValue`.

- [ ] **Step 3: Write the implementation**

Em `src/lib/telegram/poller.ts`, troque a assinatura de `callWebhook` dentro de `PollerDeps`:

```typescript
// src/lib/telegram/poller.ts
export interface PollerDeps {
  fetchNewMessages: (afterId: number | null) => Promise<TelegramMessage[]>;
  getLatestMessageId: () => Promise<number | null>;
  loadCursor: () => Promise<number | null>;
  saveCursor: (messageId: number) => Promise<void>;
  extractPromo: (text: string) => Promise<PromoExtractionResult>;
  callWebhook: (body: {
    link: string;
    coupon?: string;
    discountedPrice?: number;
    discountPercent?: number;
    minPurchaseValue?: number;
    maxDiscountValue?: number;
  }) => Promise<WebhookCallResult>;
  acquireLock: () => Promise<boolean>;
  releaseLock: () => Promise<void>;
  batchLimit?: number;
}
```

E troque a chamada a `deps.callWebhook` dentro de `runPoll`:

```typescript
// src/lib/telegram/poller.ts (dentro de runPoll, troca o bloco try existente)
    try {
      const result = await deps.callWebhook({
        link: extraction.link,
        coupon: extraction.coupon ?? undefined,
        discountedPrice: extraction.discountedPrice ?? undefined,
        discountPercent: extraction.discountPercent ?? undefined,
        minPurchaseValue: extraction.minPurchaseValue ?? undefined,
        maxDiscountValue: extraction.maxDiscountValue ?? undefined,
      });
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/telegram/poller.test.ts`
Expected: PASS.

- [ ] **Step 5: Update the real callWebhook in telegram-poll/route.ts**

Em `src/app/api/telegram-poll/route.ts`, troque a assinatura de `callWebhook` (sem teste automatizado pra esse arquivo — mesma limitação já aceita pro resto da integração GramJS):

```typescript
// src/app/api/telegram-poll/route.ts
async function callWebhook(body: {
  link: string;
  coupon?: string;
  discountedPrice?: number;
  discountPercent?: number;
  minPurchaseValue?: number;
  maxDiscountValue?: number;
}): Promise<{ ok: boolean; status: number }> {
```

(O corpo da função não muda — já faz `JSON.stringify(body)` com o objeto inteiro.)

- [ ] **Step 6: Run the full test suite and typecheck**

Run: `npx vitest run`
Expected: todos os testes passando.

Run: `npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 7: Commit**

```bash
git add src/lib/telegram/poller.ts src/lib/telegram/poller.test.ts src/app/api/telegram-poll/route.ts
git commit -m "feat: poller repassa campos de desconto de cupom pro webhook"
```

---

### Task 3: `ListCouponError` em `pipeline.ts`

**Files:**
- Modify: `src/lib/pipeline.ts`
- Modify: `src/lib/pipeline.test.ts`

**Interfaces:**
- Produces (usado pela Task 4 e Task 7): `export class ListCouponError extends Error { affiliateLink: string; constructor(affiliateLink: string) }`.
- `runPipeline` repassa `ListCouponError` sem embrulhar em `PipelineError` quando `fetchProductAndAffiliateLink` rejeita com essa classe.

- [ ] **Step 1: Write the failing test**

Adicione ao final de `src/lib/pipeline.test.ts` (mantendo os testes já existentes intactos):

```typescript
// src/lib/pipeline.test.ts (adicionar ao final do describe já existente, antes do `});` de fechamento)
  it('repassa ListCouponError sem embrulhar em PipelineError', async () => {
    const deps = makeDeps({
      fetchProductAndAffiliateLink: vi
        .fn()
        .mockRejectedValue(new ListCouponError('https://mercadolivre.com/sec/xyz789')),
    });

    await expect(
      runPipeline('https://www.mercadolivre.com.br/social/promozonevip/lists', deps),
    ).rejects.toMatchObject({
      name: 'ListCouponError',
      affiliateLink: 'https://mercadolivre.com/sec/xyz789',
    });
    expect(deps.buildPostText).not.toHaveBeenCalled();
    expect(deps.publishArticle).not.toHaveBeenCalled();
  });
```

E troque o import no topo do arquivo pra incluir `ListCouponError`:

```typescript
// src/lib/pipeline.test.ts (topo do arquivo, troca o import existente)
import {
  InvalidLinkError,
  ListCouponError,
  ProductNotFoundError,
  SessionExpiredError,
  runPipeline,
  type PipelineDeps,
} from './pipeline';
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/pipeline.test.ts`
Expected: FAIL — `ListCouponError` ainda não existe em `pipeline.ts` (erro de import/tipo).

- [ ] **Step 3: Write the implementation**

Em `src/lib/pipeline.ts`, adicione a classe nova ao lado das já existentes (depois de `InvalidLinkError`):

```typescript
// src/lib/pipeline.ts
export class ListCouponError extends Error {
  affiliateLink: string;

  constructor(affiliateLink: string) {
    super('LIST_COUPON');
    this.name = 'ListCouponError';
    this.affiliateLink = affiliateLink;
  }
}
```

E dentro de `runPipeline`, no `catch` do bloco que chama `deps.fetchProductAndAffiliateLink`, adicione o repasse **antes** dos outros `if`:

```typescript
// src/lib/pipeline.ts (dentro de runPipeline, topo do catch block já existente)
  try {
    ({ product, affiliateLink } = await deps.fetchProductAndAffiliateLink(link));
  } catch (err) {
    if (err instanceof ListCouponError) {
      // Não é uma falha — é um resultado de "cupom sem produto único", que o
      // webhook trata como um caminho de publicação separado. Repassa sem
      // embrulhar em PipelineError, senão o webhook não conseguiria
      // distinguir esse caso de uma falha de verdade.
      throw err;
    }
    if (err instanceof SessionExpiredError) {
      throw new PipelineError('affiliate_link', err.message, 'SESSION_EXPIRED');
    }
    if (err instanceof ProductNotFoundError) {
      throw new PipelineError('product_fetch', err.message);
    }
    if (err instanceof InvalidLinkError) {
      throw new PipelineError('link_parse', err.message);
    }
    throw new PipelineError('affiliate_link', (err as Error).message);
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/pipeline.test.ts`
Expected: PASS.

- [ ] **Step 5: Run the full test suite**

Run: `npx vitest run`
Expected: todos os testes passando.

- [ ] **Step 6: Commit**

```bash
git add src/lib/pipeline.ts src/lib/pipeline.test.ts
git commit -m "feat: adiciona ListCouponError, repassado sem embrulho pelo pipeline"
```

---

### Task 4: Script Playwright gera link próprio pra cupom de lista

**Files:**
- Modify: `src/lib/mercadolivre/generate-link.playwright.mjs`
- Modify: `src/lib/mercadolivre/affiliateLink.ts`
- Modify: `src/lib/mercadolivre/affiliateLink.test.ts`

**Interfaces:**
- Consumes (da Task 3): `ListCouponError` de `../pipeline`.
- Produces (usado pela Task 7): `fetchProductAndAffiliateLink` agora pode rejeitar com `ListCouponError` (além dos erros já existentes) quando o link resolvido é uma página de lista do Mercado Livre.

- [ ] **Step 1: Write the failing tests**

Em `src/lib/mercadolivre/affiliateLink.test.ts`, **remova** o teste existente (ele testa o comportamento antigo, que este task substitui):

```typescript
// REMOVER este teste de src/lib/mercadolivre/affiliateLink.test.ts:
  it('lança InvalidLinkError (não ProductNotFoundError) quando o script reporta PRODUCT_LIST_LINK no stderr', async () => {
    mockExecFileFailure('PRODUCT_LIST_LINK (resolvido para: https://www.mercadolivre.com.br/social/promozonevip/lists)');

    await expect(
      fetchProductAndAffiliateLink('https://www.mercadolivre.com.br/social/promozonevip/lists'),
    ).rejects.toThrow('índice de listas');
  });
```

E **adicione**, no mesmo lugar, estes dois testes novos:

```typescript
// src/lib/mercadolivre/affiliateLink.test.ts (no lugar do teste removido acima)
  it('lança ListCouponError com o link de afiliado quando o script reporta isListCoupon:true (cupom de lista)', async () => {
    mockExecFileSuccess(
      `${JSON.stringify({
        marketplace: 'mercadolivre',
        affiliateLink: 'https://mercadolivre.com/sec/xyz789',
        isListCoupon: true,
      })}\n`,
    );

    await expect(
      fetchProductAndAffiliateLink('https://www.mercadolivre.com.br/social/promozonevip/lists'),
    ).rejects.toMatchObject({
      name: 'ListCouponError',
      affiliateLink: 'https://mercadolivre.com/sec/xyz789',
    });
  });

  it('lança erro genérico quando isListCoupon:true mas affiliateLink está ausente ou inválido', async () => {
    mockExecFileSuccess(
      `${JSON.stringify({
        marketplace: 'mercadolivre',
        isListCoupon: true,
      })}\n`,
    );

    await expect(
      fetchProductAndAffiliateLink('https://www.mercadolivre.com.br/social/promozonevip/lists'),
    ).rejects.toThrow('Saída inesperada do script de afiliado');
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/mercadolivre/affiliateLink.test.ts`
Expected: FAIL — `fetchProductAndAffiliateLink` ainda não reconhece `isListCoupon`, então rejeita com o erro genérico de "Saída inesperada" pro primeiro teste novo (esperava `ListCouponError`), e o teste do que foi removido não existe mais pra comparar.

- [ ] **Step 3: Refactor the Playwright script's linkbuilder into a shared function**

Em `src/lib/mercadolivre/generate-link.playwright.mjs`, localize o bloco final do Mercado Livre (comentário `// 2 (Mercado Livre). Visita o gerador...`) e **extraia** essa lógica pra uma função nova, declarada **antes** de `async function main()`:

```javascript
// src/lib/mercadolivre/generate-link.playwright.mjs (adicionar antes de "async function main()")
// Visita o gerador de link de afiliado do Mercado Livre (só acessível pra
// conta já aprovada no Programa de Afiliados) e gera um link de afiliado
// pra qualquer URL do domínio deles — não é restrito a página de produto,
// funciona igual pra página de lista de cupom (confirmado em validação
// manual real, 2026-08-04). Reaproveitado tanto pro fluxo normal de
// produto quanto pro fluxo de cupom de lista.
async function generateMlAffiliateLink(page, url) {
  await page.goto('https://www.mercadolivre.com.br/afiliados/linkbuilder#hub', {
    waitUntil: 'domcontentloaded',
    timeout: 45000,
  });

  const urlField = page.locator('#url-0');
  const formVisible = await urlField.isVisible({ timeout: 15000 }).catch(() => false);

  if (!formVisible) {
    console.error('SESSION_EXPIRED');
    process.exit(1);
  }

  // A SPA religa os handlers reativos (que habilitam o botão "Gerar") um
  // pouco depois do campo ficar visível — preencher rápido demais faz o
  // valor entrar no DOM mas o estado do React não é atualizado, e o botão
  // fica preso em disabled. Dá um tempo de acomodação antes de preencher.
  await page.waitForTimeout(2500);
  await urlField.fill(url);
  await page.waitForTimeout(500);

  const gerarBtn = page.getByRole('button', { name: 'Gerar' });
  const stillDisabled = await gerarBtn.evaluate((el) => el.hasAttribute('disabled')).catch(() => true);
  if (stillDisabled) {
    // Fallback: repete o preenchimento caso o primeiro tenha corrido antes
    // da hidratação religar o handler.
    await urlField.fill('');
    await urlField.fill(url);
    await page.waitForTimeout(1500);
  }

  await gerarBtn.click({ timeout: 30000 });

  const affiliateLink = await page.locator('#textfield-copyLink-1').inputValue({ timeout: 15000 });

  if (!affiliateLink || !affiliateLink.startsWith('http')) {
    throw new Error(`Campo de resultado sem link válido: "${affiliateLink}"`);
  }

  return affiliateLink.trim();
}
```

- [ ] **Step 4: Route the list-link detection to the new function instead of exiting with an error**

Ainda em `generate-link.playwright.mjs`, troque o bloco de detecção do padrão de lista (dentro do `if (isMercadoLivre) { ... }`, o comentário que hoje termina com `console.error('PRODUCT_LIST_LINK...'); process.exit(1);`):

```javascript
// src/lib/mercadolivre/generate-link.playwright.mjs (troca o bloco de detecção de PRODUCT_LIST_LINK)
      // Cupons de loja/categoria inteira (sem produto único vinculado) às
      // vezes vêm com um link genérico pro índice de listas curadas do
      // afiliado (ex: /social/promozonevip/lists) em vez de um produto —
      // essa página não tem título/preço/imagem de produto pra extrair
      // (confirmado em validação manual real, 2026-07-31). Em vez de
      // descartar (comportamento antigo), gera nosso próprio link de
      // afiliado pra essa mesma página de lista — o gerador de link aceita
      // qualquer URL do domínio, não só produto (confirmado em validação
      // manual real, 2026-08-04).
      if (/\/social\/[^/]+\/lists\/?$/i.test(new URL(resolvedUrl).pathname)) {
        const affiliateLink = await generateMlAffiliateLink(page, resolvedUrl);
        console.log(JSON.stringify({ marketplace: 'mercadolivre', affiliateLink, isListCoupon: true }));
        return;
      }
```

- [ ] **Step 5: Replace the end-of-script Mercado Livre block with a call to the shared function**

Ainda em `generate-link.playwright.mjs`, localize o bloco final (`// 2 (Mercado Livre). Visita o gerador de link de afiliado...` até o `console.log(JSON.stringify({ title, price, imageUrl, marketplace: 'mercadolivre', affiliateLink: affiliateLink.trim() }));`) e troque **tudo isso** por:

```javascript
// src/lib/mercadolivre/generate-link.playwright.mjs (troca o bloco final do Mercado Livre)
    // 2 (Mercado Livre). Gera o link de afiliado pra URL do produto.
    const affiliateLink = await generateMlAffiliateLink(page, resolvedUrl);
    console.log(JSON.stringify({ title, price, imageUrl, marketplace: 'mercadolivre', affiliateLink }));
```

- [ ] **Step 6: Update affiliateLink.ts to recognize the new output shape**

Em `src/lib/mercadolivre/affiliateLink.ts`, troque o import no topo pra incluir `ListCouponError`:

```typescript
// src/lib/mercadolivre/affiliateLink.ts (topo do arquivo)
import { InvalidLinkError, ListCouponError, ProductNotFoundError, SessionExpiredError } from '../pipeline';
```

**Remova** o bloco que mapeava `PRODUCT_LIST_LINK` (não é mais emitido pelo script — o caso de cupom de lista agora termina com sucesso, não com stderr):

```typescript
// REMOVER de src/lib/mercadolivre/affiliateLink.ts:
    if (stderr.includes('PRODUCT_LIST_LINK')) {
      throw new InvalidLinkError(
        `Link aponta pro índice de listas do afiliado, sem produto único associado: ${stderr.slice(0, 300)}`,
      );
    }
```

Troque o tipo de `parsed` (logo depois do `JSON.parse(trimmed)`) pra incluir o campo novo, e adicione o branch de cupom de lista **antes** da validação de `title`/`price`/`imageUrl` já existente:

```typescript
// src/lib/mercadolivre/affiliateLink.ts (troca a declaração de `parsed` e adiciona o branch novo)
  const trimmed = stdout.trim();
  let parsed: {
    title?: unknown;
    price?: unknown;
    imageUrl?: unknown;
    marketplace?: unknown;
    affiliateLink?: unknown;
    isListCoupon?: unknown;
  };
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    throw new Error(`Saída inesperada do script de afiliado: ${trimmed.slice(0, 200)}`);
  }

  if (parsed.isListCoupon === true) {
    if (typeof parsed.affiliateLink !== 'string' || !parsed.affiliateLink.startsWith('http')) {
      throw new Error(`Saída inesperada do script de afiliado: ${trimmed.slice(0, 200)}`);
    }
    throw new ListCouponError(parsed.affiliateLink);
  }

  if (
    typeof parsed.title !== 'string' ||
    typeof parsed.price !== 'number' ||
    typeof parsed.imageUrl !== 'string' ||
    typeof parsed.affiliateLink !== 'string' ||
    !parsed.affiliateLink.startsWith('http')
  ) {
    throw new Error(`Saída inesperada do script de afiliado: ${trimmed.slice(0, 200)}`);
  }
```

(O resto da função, dali pra baixo, não muda.)

- [ ] **Step 7: Run tests to verify they pass**

Run: `npx vitest run src/lib/mercadolivre/affiliateLink.test.ts`
Expected: PASS (todos os testes, incluindo os 2 novos).

- [ ] **Step 8: Run the full test suite and typecheck**

Run: `npx vitest run`
Expected: todos os testes passando.

Run: `npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 9: Commit**

```bash
git add src/lib/mercadolivre/generate-link.playwright.mjs src/lib/mercadolivre/affiliateLink.ts src/lib/mercadolivre/affiliateLink.test.ts
git commit -m "feat: gera link de afiliado proprio pra cupom de lista do ML"
```

---

### Task 5: Legenda e texto de artigo pro cupom (funções puras)

**Files:**
- Modify: `src/lib/content/template.ts`
- Create: `src/lib/content/couponTemplate.ts`
- Create: `src/lib/content/couponTemplate.test.ts`

**Interfaces:**
- Produces (usado pela Task 7): `export interface CouponDetails { coupon: string; affiliateLink: string; discountPercent?: number; minPurchaseValue?: number; maxDiscountValue?: number; }`, `export function buildCouponCaption(details: CouponDetails): string`, `export function buildCouponArticleText(details: CouponDetails): { title: string; body: string }`.

- [ ] **Step 1: Export the existing escapeHtml helper for reuse**

Em `src/lib/content/template.ts`, adicione `export` na função `escapeHtml` já existente (só essa palavra muda, o corpo da função continua igual):

```typescript
// src/lib/content/template.ts (troca só a linha da assinatura)
export function escapeHtml(text: string): string {
```

- [ ] **Step 2: Write the failing tests**

Crie `src/lib/content/couponTemplate.test.ts`:

```typescript
// src/lib/content/couponTemplate.test.ts
import { describe, expect, it } from 'vitest';
import { buildCouponArticleText, buildCouponCaption } from './couponTemplate';

const FULL_DETAILS = {
  coupon: 'LIVROSJOGOSRELAMPAGO',
  affiliateLink: 'https://mercadolivre.com/sec/xyz789',
  discountPercent: 20,
  minPurchaseValue: 59,
  maxDiscountValue: 30,
};

describe('buildCouponCaption', () => {
  it('monta a legenda completa quando todos os detalhes de desconto estão presentes', () => {
    const text = buildCouponCaption(FULL_DETAILS);
    expect(text).toBe(
      '🎟️ Cupom Mercado Livre: LIVROSJOGOSRELAMPAGO\n\n🔥 20% OFF em compras acima de R$59,00\n\n💰 Desconto máximo de R$30,00\n\n🔗 Ative: https://mercadolivre.com/sec/xyz789\n\n#promocao #cupom #mercadolivre',
    );
  });

  it('omite as linhas de desconto quando discountPercent, minPurchaseValue e maxDiscountValue estão ausentes', () => {
    const text = buildCouponCaption({
      coupon: 'LIVROSJOGOSRELAMPAGO',
      affiliateLink: 'https://mercadolivre.com/sec/xyz789',
    });
    expect(text).toBe(
      '🎟️ Cupom Mercado Livre: LIVROSJOGOSRELAMPAGO\n\n🔗 Ative: https://mercadolivre.com/sec/xyz789\n\n#promocao #cupom #mercadolivre',
    );
  });

  it('mostra o percentual sem "em compras acima de" quando minPurchaseValue está ausente', () => {
    const text = buildCouponCaption({
      coupon: 'LIVROSJOGOSRELAMPAGO',
      affiliateLink: 'https://mercadolivre.com/sec/xyz789',
      discountPercent: 20,
    });
    expect(text).toBe(
      '🎟️ Cupom Mercado Livre: LIVROSJOGOSRELAMPAGO\n\n🔥 20% OFF\n\n🔗 Ative: https://mercadolivre.com/sec/xyz789\n\n#promocao #cupom #mercadolivre',
    );
  });
});

describe('buildCouponArticleText', () => {
  it('monta título e corpo completos quando todos os detalhes de desconto estão presentes', () => {
    const result = buildCouponArticleText(FULL_DETAILS);
    expect(result.title).toBe('Cupom Mercado Livre: 20% OFF em compras acima de R$59,00');
    expect(result.body).toBe(
      'Cupom: <strong>LIVROSJOGOSRELAMPAGO</strong><br><br>20% OFF em compras acima de R$59,00<br><br>Desconto máximo de R$30,00<br><br><a href="https://mercadolivre.com/sec/xyz789">Ative o cupom</a>',
    );
  });

  it('usa o código do cupom como título quando discountPercent está ausente', () => {
    const result = buildCouponArticleText({
      coupon: 'LIVROSJOGOSRELAMPAGO',
      affiliateLink: 'https://mercadolivre.com/sec/xyz789',
    });
    expect(result.title).toBe('Cupom Mercado Livre: LIVROSJOGOSRELAMPAGO');
    expect(result.body).toBe(
      'Cupom: <strong>LIVROSJOGOSRELAMPAGO</strong><br><br><a href="https://mercadolivre.com/sec/xyz789">Ative o cupom</a>',
    );
  });

  it('escapa HTML no código do cupom e no link de afiliado', () => {
    const result = buildCouponArticleText({
      coupon: '<script>X</script>',
      affiliateLink: 'https://mercadolivre.com/sec/xyz789?a=1&b=2',
    });
    expect(result.body).toContain('&lt;script&gt;X&lt;/script&gt;');
    expect(result.body).toContain('https://mercadolivre.com/sec/xyz789?a=1&amp;b=2');
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run src/lib/content/couponTemplate.test.ts`
Expected: FAIL — `Failed to resolve import "./couponTemplate"` (o arquivo ainda não existe).

- [ ] **Step 4: Write the implementation**

Crie `src/lib/content/couponTemplate.ts`:

```typescript
// src/lib/content/couponTemplate.ts
import { escapeHtml } from './template';

function formatPrice(value: number): string {
  return value.toLocaleString('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export interface CouponDetails {
  coupon: string;
  affiliateLink: string;
  discountPercent?: number;
  minPurchaseValue?: number;
  maxDiscountValue?: number;
}

function buildMinPurchasePart(details: CouponDetails): string {
  return typeof details.minPurchaseValue === 'number'
    ? ` em compras acima de R$${formatPrice(details.minPurchaseValue)}`
    : '';
}

export function buildCouponCaption(details: CouponDetails): string {
  const lines: string[] = [`🎟️ Cupom Mercado Livre: ${details.coupon}`];

  if (typeof details.discountPercent === 'number') {
    lines.push(`🔥 ${details.discountPercent}% OFF${buildMinPurchasePart(details)}`);
  }

  if (typeof details.maxDiscountValue === 'number') {
    lines.push(`💰 Desconto máximo de R$${formatPrice(details.maxDiscountValue)}`);
  }

  lines.push(`🔗 Ative: ${details.affiliateLink}`);
  lines.push('#promocao #cupom #mercadolivre');

  return lines.join('\n\n');
}

export function buildCouponArticleText(details: CouponDetails): { title: string; body: string } {
  const minPurchasePart = buildMinPurchasePart(details);
  const titleSuffix =
    typeof details.discountPercent === 'number' ? `${details.discountPercent}% OFF${minPurchasePart}` : details.coupon;
  const title = `Cupom Mercado Livre: ${titleSuffix}`.slice(0, 255);

  const bodyLines: string[] = [`Cupom: <strong>${escapeHtml(details.coupon)}</strong>`];
  if (typeof details.discountPercent === 'number') {
    bodyLines.push(`${details.discountPercent}% OFF${minPurchasePart}`);
  }
  if (typeof details.maxDiscountValue === 'number') {
    bodyLines.push(`Desconto máximo de R$${formatPrice(details.maxDiscountValue)}`);
  }
  bodyLines.push(`<a href="${escapeHtml(details.affiliateLink)}">Ative o cupom</a>`);

  return { title, body: bodyLines.join('<br><br>') };
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/lib/content/couponTemplate.test.ts`
Expected: PASS (todos os 6 testes).

- [ ] **Step 6: Run the full test suite**

Run: `npx vitest run`
Expected: todos os testes passando.

- [ ] **Step 7: Commit**

```bash
git add src/lib/content/template.ts src/lib/content/couponTemplate.ts src/lib/content/couponTemplate.test.ts
git commit -m "feat: funcoes puras de legenda e artigo pro cupom de lista"
```

---

### Task 6: Rota `/api/coupon-image`

**Files:**
- Create: `src/app/api/coupon-image/route.tsx`
- Create: `src/app/api/coupon-image/route.test.ts`

**Interfaces:**
- Produces (usado pela Task 7): `GET /api/coupon-image?coupon=X&discountPercent=Y&minPurchaseValue=Z&maxDiscountValue=W` → imagem JPEG 1080x1350. `coupon` obrigatório; os outros 3 opcionais.

- [ ] **Step 1: Write the failing tests**

Crie `src/app/api/coupon-image/route.test.ts`:

```typescript
// src/app/api/coupon-image/route.test.ts
import { describe, expect, it } from 'vitest';
import { GET } from './route';

describe('GET /api/coupon-image', () => {
  it('retorna 400 quando falta o parâmetro coupon', async () => {
    const request = new Request('https://promopost.example.com/api/coupon-image');
    const response = await GET(request);
    const json = await response.json();

    expect(response.status).toBe(400);
    expect(json).toEqual({ erro: 'Parâmetro obrigatório ausente: coupon' });
  });

  it('retorna 400 quando discountPercent não é um número válido', async () => {
    const request = new Request(
      'https://promopost.example.com/api/coupon-image?coupon=LIVROSJOGOSRELAMPAGO&discountPercent=abc',
    );
    const response = await GET(request);
    const json = await response.json();

    expect(response.status).toBe(400);
    expect(json).toEqual({ erro: 'Parâmetro discountPercent inválido' });
  });

  it('retorna 400 quando minPurchaseValue não é um número válido', async () => {
    const request = new Request(
      'https://promopost.example.com/api/coupon-image?coupon=LIVROSJOGOSRELAMPAGO&minPurchaseValue=abc',
    );
    const response = await GET(request);
    const json = await response.json();

    expect(response.status).toBe(400);
    expect(json).toEqual({ erro: 'Parâmetro minPurchaseValue inválido' });
  });

  it('retorna 400 quando maxDiscountValue não é um número válido', async () => {
    const request = new Request(
      'https://promopost.example.com/api/coupon-image?coupon=LIVROSJOGOSRELAMPAGO&maxDiscountValue=abc',
    );
    const response = await GET(request);
    const json = await response.json();

    expect(response.status).toBe(400);
    expect(json).toEqual({ erro: 'Parâmetro maxDiscountValue inválido' });
  });

  it('retorna 200 com content-type image/jpeg quando só coupon é informado', async () => {
    const request = new Request('https://promopost.example.com/api/coupon-image?coupon=LIVROSJOGOSRELAMPAGO');
    const response = await GET(request);

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('image/jpeg');
  });

  it('retorna 200 com content-type image/jpeg quando todos os parâmetros são informados', async () => {
    const request = new Request(
      'https://promopost.example.com/api/coupon-image?coupon=LIVROSJOGOSRELAMPAGO&discountPercent=20&minPurchaseValue=59&maxDiscountValue=30',
    );
    const response = await GET(request);

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('image/jpeg');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/app/api/coupon-image/route.test.ts`
Expected: FAIL — `Failed to resolve import "./route"` (o arquivo ainda não existe).

- [ ] **Step 3: Write the implementation**

Crie `src/app/api/coupon-image/route.tsx`:

```tsx
// src/app/api/coupon-image/route.tsx
import { ImageResponse } from 'next/og';
import sharp from 'sharp';

function toErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function formatPrice(value: number): string {
  return value.toLocaleString('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export async function GET(request: Request): Promise<Response> {
  const { searchParams } = new URL(request.url);
  const coupon = searchParams.get('coupon');
  const discountPercentParam = searchParams.get('discountPercent');
  const minPurchaseValueParam = searchParams.get('minPurchaseValue');
  const maxDiscountValueParam = searchParams.get('maxDiscountValue');

  if (!coupon) {
    return Response.json({ erro: 'Parâmetro obrigatório ausente: coupon' }, { status: 400 });
  }

  const discountPercent = discountPercentParam !== null ? Number(discountPercentParam) : undefined;
  const minPurchaseValue = minPurchaseValueParam !== null ? Number(minPurchaseValueParam) : undefined;
  const maxDiscountValue = maxDiscountValueParam !== null ? Number(maxDiscountValueParam) : undefined;

  if (discountPercentParam !== null && (!Number.isFinite(discountPercent) || (discountPercent as number) < 0)) {
    return Response.json({ erro: 'Parâmetro discountPercent inválido' }, { status: 400 });
  }
  if (minPurchaseValueParam !== null && (!Number.isFinite(minPurchaseValue) || (minPurchaseValue as number) < 0)) {
    return Response.json({ erro: 'Parâmetro minPurchaseValue inválido' }, { status: 400 });
  }
  if (maxDiscountValueParam !== null && (!Number.isFinite(maxDiscountValue) || (maxDiscountValue as number) < 0)) {
    return Response.json({ erro: 'Parâmetro maxDiscountValue inválido' }, { status: 400 });
  }

  try {
    const pngResponse = new ImageResponse(
      (
        <div
          style={{
            width: '100%',
            height: '100%',
            display: 'flex',
            flexDirection: 'column',
            background: '#2d2d2d',
            padding: '80px 64px',
            justifyContent: 'center',
          }}
        >
          <div
            style={{
              display: 'flex',
              color: '#fff159',
              fontSize: 40,
              fontWeight: 700,
              border: '4px solid #fff159',
              borderRadius: 12,
              padding: '12px 28px',
              alignSelf: 'flex-start',
            }}
          >
            MERCADO LIVRE
          </div>
          <div style={{ display: 'flex', color: 'white', fontSize: 64, fontWeight: 700, marginTop: 48 }}>
            Cupom de desconto
          </div>
          <div style={{ display: 'flex', color: '#ffe14d', fontSize: 80, fontWeight: 700, marginTop: 24 }}>
            {coupon}
          </div>
          {typeof discountPercent === 'number' ? (
            <div style={{ display: 'flex', color: 'white', fontSize: 52, marginTop: 40 }}>
              {discountPercent}% OFF
            </div>
          ) : null}
          {typeof minPurchaseValue === 'number' ? (
            <div style={{ display: 'flex', color: 'rgba(255,255,255,0.85)', fontSize: 36, marginTop: 16 }}>
              Em compras acima de R${formatPrice(minPurchaseValue)}
            </div>
          ) : null}
          {typeof maxDiscountValue === 'number' ? (
            <div style={{ display: 'flex', color: 'rgba(255,255,255,0.85)', fontSize: 36, marginTop: 8 }}>
              Desconto máximo de R${formatPrice(maxDiscountValue)}
            </div>
          ) : null}
        </div>
      ),
      { width: 1080, height: 1350 },
    );

    // next/og produz PNG por padrão — converte pra JPEG de verdade porque
    // alguns consumidores (GramJS, ao repassar essa URL pro Telegram)
    // decidem foto-vs-documento só pela extensão no fim da string da URL,
    // não pelo conteúdo real (mesmo motivo já documentado no proxy do
    // TikTok/Telegram).
    const pngBuffer = Buffer.from(await pngResponse.arrayBuffer());
    const jpegBuffer = await sharp(pngBuffer).jpeg({ quality: 90 }).toBuffer();

    return new Response(new Uint8Array(jpegBuffer), {
      status: 200,
      headers: { 'content-type': 'image/jpeg' },
    });
  } catch (err) {
    console.error('Erro ao gerar imagem de cupom:', err);
    return Response.json(
      { erro: `Falha ao gerar imagem de cupom: ${toErrorMessage(err)}` },
      { status: 500 },
    );
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/app/api/coupon-image/route.test.ts`
Expected: PASS (todos os 6 testes).

- [ ] **Step 5: Run the full test suite**

Run: `npx vitest run`
Expected: todos os testes passando.

- [ ] **Step 6: Commit**

```bash
git add src/app/api/coupon-image/route.tsx src/app/api/coupon-image/route.test.ts
git commit -m "feat: rota de imagem generica de cupom (next/og + JPEG via sharp)"
```

---

### Task 7: Integrar no webhook

**Files:**
- Modify: `src/app/api/webhook/route.ts`
- Modify: `src/app/api/webhook/route.test.ts`

**Interfaces:**
- Consumes: `ListCouponError` (Task 3), `buildCouponCaption`/`buildCouponArticleText`/`CouponDetails` (Task 5), `/api/coupon-image` (Task 6).

- [ ] **Step 1: Write the failing test**

Em `src/app/api/webhook/route.test.ts`, adicione os mocks novos junto aos `vi.mock` já existentes, no topo do arquivo:

```typescript
// src/app/api/webhook/route.test.ts (adicionar junto aos vi.mock já existentes, no topo)
vi.mock('@/lib/content/couponTemplate', () => ({
  buildCouponCaption: vi.fn(),
  buildCouponArticleText: vi.fn(),
}));
```

E os imports correspondentes (junto aos imports já existentes):

```typescript
// src/app/api/webhook/route.test.ts (adicionar junto aos imports já existentes)
import { ListCouponError } from '@/lib/pipeline';
import { buildCouponArticleText, buildCouponCaption } from '@/lib/content/couponTemplate';
```

Depois, adicione este teste novo dentro do `describe('POST /api/webhook', ...)`, próximo aos outros testes de caminho feliz:

```typescript
// src/app/api/webhook/route.test.ts (adicionar dentro do describe já existente)
  it('publica um post de cupom em todos os canais quando o pipeline rejeita com ListCouponError', async () => {
    stubMetaEnv();
    stubWebhookBaseUrl();
    stubTikTokEnv();
    stubTelegramGroupsEnv();
    vi.stubEnv('WEBHOOK_SECRET', 'correct-secret');
    vi.mocked(parseItemId).mockReturnValue('MLB123');
    vi.mocked(fetchProductAndAffiliateLink).mockRejectedValue(
      new ListCouponError('https://mercadolivre.com/sec/xyz789'),
    );
    vi.mocked(buildCouponCaption).mockReturnValue('legenda do cupom');
    vi.mocked(buildCouponArticleText).mockReturnValue({
      title: 'Cupom Mercado Livre: 20% OFF em compras acima de R$59,00',
      body: 'corpo do artigo do cupom',
    });
    vi.mocked(publishArticle).mockResolvedValue({
      url: 'https://loja.myshopify.com/blogs/noticias/cupom-mercado-livre',
    });
    vi.mocked(postToFacebook).mockResolvedValue({ postId: 'fb-cupom-1' });
    vi.mocked(postToInstagram).mockResolvedValue({ postId: 'ig-cupom-1' });
    vi.mocked(postStoryToInstagram).mockResolvedValue({ postId: 'story-cupom-1' });
    vi.mocked(postToTikTok).mockResolvedValue({ postId: 'tt-cupom-1' });
    vi.mocked(postToTelegramGroups).mockResolvedValue({
      ok: true,
      results: [{ groupId: '-100111', ok: true }],
    });

    const response = await POST(
      makeRequest({
        link: 'https://www.mercadolivre.com.br/social/promozonevip/lists',
        coupon: 'LIVROSJOGOSRELAMPAGO',
        discountPercent: 20,
        minPurchaseValue: 59,
        maxDiscountValue: 30,
      }),
    );
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json).toEqual({
      postUrl: 'https://loja.myshopify.com/blogs/noticias/cupom-mercado-livre',
      facebook: { ok: true, postId: 'fb-cupom-1' },
      instagram: { ok: true, postId: 'ig-cupom-1' },
      story: { ok: true, postId: 'story-cupom-1' },
      tiktok: { ok: true, postId: 'tt-cupom-1' },
      telegram: { ok: true, results: [{ groupId: '-100111', ok: true }] },
    });
    expect(buildCouponCaption).toHaveBeenCalledWith({
      coupon: 'LIVROSJOGOSRELAMPAGO',
      affiliateLink: 'https://mercadolivre.com/sec/xyz789',
      discountPercent: 20,
      minPurchaseValue: 59,
      maxDiscountValue: 30,
    });
    expect(publishArticle).toHaveBeenCalledWith(
      'Cupom Mercado Livre: 20% OFF em compras acima de R$59,00',
      'corpo do artigo do cupom',
      'https://promopost.example.com/api/coupon-image?coupon=LIVROSJOGOSRELAMPAGO&discountPercent=20&minPurchaseValue=59&maxDiscountValue=30',
    );
  });

  it('retorna 400 quando ListCouponError acontece mas nenhum coupon foi informado no corpo', async () => {
    vi.stubEnv('WEBHOOK_SECRET', 'correct-secret');
    vi.mocked(parseItemId).mockReturnValue('MLB123');
    vi.mocked(fetchProductAndAffiliateLink).mockRejectedValue(
      new ListCouponError('https://mercadolivre.com/sec/xyz789'),
    );

    const response = await POST(
      makeRequest({ link: 'https://www.mercadolivre.com.br/social/promozonevip/lists' }),
    );
    const json = await response.json();

    expect(response.status).toBe(400);
    expect(json).toEqual({ erro: 'cupom de lista detectado, mas nenhum código de cupom foi informado' });
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/app/api/webhook/route.test.ts`
Expected: FAIL — `ListCouponError` não é tratado especialmente ainda, então cai no `catch` genérico (`{ erro: 'erro interno' }`, 500) em vez de publicar o cupom.

- [ ] **Step 3: Wire the coupon path into the webhook**

Em `src/app/api/webhook/route.ts`, adicione os imports novos (junto aos já existentes):

```typescript
// src/app/api/webhook/route.ts (adicionar junto aos imports já existentes)
import { ListCouponError, PipelineError, runPipeline } from '@/lib/pipeline';
import { buildCouponArticleText, buildCouponCaption, type CouponDetails } from '@/lib/content/couponTemplate';
```

(Note: `PipelineError, runPipeline` já são importados hoje de `@/lib/pipeline` — troque a linha de import existente pra incluir `ListCouponError` junto, em vez de duplicar o import.)

Adicione a função `buildCouponImageUrl` como privada, junto a `buildStoryImageUrl`/`buildTikTokImageProxyUrl`:

```typescript
// src/app/api/webhook/route.ts (adicionar junto a buildStoryImageUrl/buildTikTokImageProxyUrl)
function buildCouponImageUrl(details: CouponDetails): string {
  const baseUrl = process.env.WEBHOOK_BASE_URL;
  if (!baseUrl) {
    throw new Error('WEBHOOK_BASE_URL não configurado');
  }
  const params = new URLSearchParams({ coupon: details.coupon });
  if (typeof details.discountPercent === 'number') {
    params.set('discountPercent', String(details.discountPercent));
  }
  if (typeof details.minPurchaseValue === 'number') {
    params.set('minPurchaseValue', String(details.minPurchaseValue));
  }
  if (typeof details.maxDiscountValue === 'number') {
    params.set('maxDiscountValue', String(details.maxDiscountValue));
  }
  return `${baseUrl}/api/coupon-image?${params.toString()}`;
}
```

Adicione a função `postCouponToSocialNetworks`, logo depois de `postToSocialNetworks` (mesmo arquivo):

```typescript
// src/app/api/webhook/route.ts (adicionar depois de postToSocialNetworks)
async function postCouponToSocialNetworks(
  couponImageUrl: string,
  caption: string,
  articleTitle: string,
): Promise<{
  facebook: SocialResult;
  instagram: SocialResult;
  story: SocialResult;
  tiktok: SocialResult;
  telegram: TelegramGroupsResult;
}> {
  const storyPromise: Promise<SocialResult> = (async () => {
    if (!isMetaConfigured()) return NAO_CONFIGURADO;
    try {
      const r = await postStoryToInstagram(couponImageUrl);
      return { ok: true, postId: r.postId };
    } catch (err) {
      console.error('Erro ao postar Story do cupom no Instagram:', err);
      return { ok: false, error: toErrorMessage(err) };
    }
  })();

  const facebookPromise: Promise<SocialResult> = (async () => {
    if (!isMetaConfigured()) return NAO_CONFIGURADO;
    try {
      const r = await postToFacebook(couponImageUrl, caption);
      return { ok: true, postId: r.postId };
    } catch (err) {
      console.error('Erro ao postar cupom no Facebook:', err);
      return { ok: false, error: toErrorMessage(err) };
    }
  })();

  const instagramPromise: Promise<SocialResult> = (async () => {
    if (!isMetaConfigured()) return NAO_CONFIGURADO;
    try {
      const r = await postToInstagram(couponImageUrl, caption);
      return { ok: true, postId: r.postId };
    } catch (err) {
      console.error('Erro ao postar cupom no Instagram:', err);
      return { ok: false, error: toErrorMessage(err) };
    }
  })();

  const tiktokPromise: Promise<SocialResult> = (async () => {
    if (!isTikTokConfigured()) return NAO_CONFIGURADO;
    try {
      const r = await postToTikTok(couponImageUrl, articleTitle.slice(0, 90), caption);
      return { ok: true, postId: r.postId };
    } catch (err) {
      console.error('Erro ao postar cupom no TikTok:', err);
      return { ok: false, error: toErrorMessage(err) };
    }
  })();

  const telegramPromise: Promise<TelegramGroupsResult> = (async () => {
    if (!isTelegramGroupsConfigured()) return { ok: false, results: [] };
    try {
      // Mesmo motivo do fragment "#.jpg" já documentado em postToSocialNetworks.
      return await postToTelegramGroups(`${couponImageUrl}#.jpg`, caption);
    } catch (err) {
      console.error('Erro ao disparar cupom pros grupos do Telegram:', err);
      return { ok: false, results: [], error: toErrorMessage(err) };
    }
  })();

  const [facebook, instagram, story, tiktok, telegram] = await Promise.all([
    facebookPromise,
    instagramPromise,
    storyPromise,
    tiktokPromise,
    telegramPromise,
  ]);

  return { facebook, instagram, story, tiktok, telegram };
}
```

Troque o corpo do `POST` (a validação do corpo da requisição precisa aceitar os campos novos, e o `try`/`catch` principal ganha o branch de `ListCouponError`):

```typescript
// src/app/api/webhook/route.ts (troca a declaração de `body` e as validações logo abaixo)
  let body: {
    link?: string;
    coupon?: string;
    discountedPrice?: number;
    discountPercent?: number;
    minPurchaseValue?: number;
    maxDiscountValue?: number;
  };
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
  if (body.discountPercent !== undefined && typeof body.discountPercent !== 'number') {
    return Response.json({ erro: 'percentual de desconto inválido' }, { status: 400 });
  }
  if (body.minPurchaseValue !== undefined && typeof body.minPurchaseValue !== 'number') {
    return Response.json({ erro: 'valor mínimo de compra inválido' }, { status: 400 });
  }
  if (body.maxDiscountValue !== undefined && typeof body.maxDiscountValue !== 'number') {
    return Response.json({ erro: 'desconto máximo inválido' }, { status: 400 });
  }
```

E troque o `try`/`catch` principal:

```typescript
// src/app/api/webhook/route.ts (troca o try/catch principal do POST)
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

    const { facebook, instagram, story, tiktok, telegram } = await postToSocialNetworks(
      result.product,
      result.affiliateLink,
      body.coupon,
      body.discountedPrice,
    );

    return Response.json(
      { postUrl: result.postUrl, facebook, instagram, story, tiktok, telegram },
      { status: 200 },
    );
  } catch (err) {
    if (err instanceof ListCouponError) {
      if (!body.coupon) {
        console.error('ListCouponError sem coupon no corpo — não é possível publicar sem código de cupom');
        return Response.json(
          { erro: 'cupom de lista detectado, mas nenhum código de cupom foi informado' },
          { status: 400 },
        );
      }
      try {
        const couponDetails: CouponDetails = {
          coupon: body.coupon,
          affiliateLink: err.affiliateLink,
          discountPercent: body.discountPercent,
          minPurchaseValue: body.minPurchaseValue,
          maxDiscountValue: body.maxDiscountValue,
        };
        const caption = buildCouponCaption(couponDetails);
        const { title, body: articleBody } = buildCouponArticleText(couponDetails);
        const couponImageUrl = buildCouponImageUrl(couponDetails);

        const published = await publishArticle(title, articleBody, couponImageUrl);

        const { facebook, instagram, story, tiktok, telegram } = await postCouponToSocialNetworks(
          couponImageUrl,
          caption,
          title,
        );

        return Response.json(
          { postUrl: published.url, facebook, instagram, story, tiktok, telegram },
          { status: 200 },
        );
      } catch (couponErr) {
        console.error('Erro ao publicar cupom de lista:', couponErr);
        return Response.json({ erro: 'erro interno ao publicar cupom' }, { status: 500 });
      }
    }
    console.error('Erro no pipeline PromoPost:', err);
    if (err instanceof PipelineError) {
      const status = err.step === 'link_parse' ? 400 : 502;
      return Response.json({ passo: err.step, erro: err.code ?? err.message }, { status });
    }
    return Response.json({ erro: 'erro interno' }, { status: 500 });
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/app/api/webhook/route.test.ts`
Expected: PASS (todos os testes, incluindo os 2 novos).

- [ ] **Step 5: Run the full test suite and typecheck**

Run: `npx vitest run`
Expected: todos os testes passando.

Run: `npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 6: Commit**

```bash
git add src/app/api/webhook/route.ts src/app/api/webhook/route.test.ts
git commit -m "feat: webhook publica cupom de lista do ML em todos os canais"
```
