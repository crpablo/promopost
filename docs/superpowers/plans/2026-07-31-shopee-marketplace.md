# Shopee como Segundo Marketplace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Detectar automaticamente se um link recebido é do Mercado Livre ou da Shopee (depois de resolver redirects), e no caso da Shopee extrair os dados do produto via scraping da própria página e gerar o link de afiliado via API oficial (GraphQL, assinada com SHA256).

**Architecture:** O mesmo script Playwright que já roda na Vercel Sandbox pro Mercado Livre (`generate-link.playwright.mjs`) continua sendo o único ponto de entrada — resolve o redirect (como já faz hoje), confere o hostname final, e ramifica: Mercado Livre segue o fluxo já existente; Shopee reaproveita a mesma sessão de browser pra extrair título/preço/imagem via meta tags, e então chama a API oficial da Shopee via `fetch` (sem precisar de novo browser) pra gerar o link de afiliado.

**Tech Stack:** Playwright (já em uso), `node:crypto` (assinatura SHA256), TypeScript, Vitest.

## Global Constraints

- Node >=24, TypeScript estrito (configs já existentes no projeto).
- Todo texto voltado ao usuário/operador (erros, docs) em português.
- Sem retentativa automática em nenhum passo — mesma filosofia do resto do projeto.
- Não usar a API `productOfferV2` da Shopee pra buscar dados do produto — só `generateShortLink`, pelo motivo já documentado no spec (produtos sem oferta ativa de afiliado não apareceriam ali). Dados do produto continuam vindo de scraping da própria página.
- Shopee não usa sessão logada nem bootstrap manual — só credenciais fixas (`app_id`/`secret_key`) via variável de ambiente.
- Nenhuma mudança no template do blog (`src/lib/content/template.ts`) — já é agnóstico de marketplace.
- Formato exato das meta tags da página de produto Shopee e o domínio regional exato da API ainda não confirmados — implementação é uma primeira tentativa baseada em padrões conhecidos (Open Graph), sujeita a ajuste na validação manual real com links de produto reais.

---

### Task 1: Product compartilhado entre marketplaces + hashtag dinâmica na legenda social

**Files:**
- Create: `src/lib/marketplace/types.ts`
- Modify: `src/lib/mercadolivre/affiliateLink.ts`
- Modify: `src/lib/pipeline.ts`
- Modify: `src/lib/content/template.ts`
- Modify: `src/lib/social/caption.ts`
- Modify: `src/app/api/webhook/route.ts`
- Test: `src/lib/social/caption.test.ts`

**Interfaces:**
- Produces: `interface Product { title: string; price: number; imageUrl: string; marketplace?: 'mercadolivre' | 'shopee' }` em `src/lib/marketplace/types.ts` — usada por todas as tasks seguintes e por todo o pipeline existente (Shopify, redes sociais). Campo `marketplace` é **opcional** deliberadamente: literais de `Product` já existentes em outros testes do projeto (`pipeline.test.ts`, `template.test.ts`, `webhook/route.test.ts`, `instagram.test.ts`, `facebook.test.ts`, `tiktok.test.ts`) não o incluem e não devem precisar de nenhuma edição — eles continuam válidos porque o campo é opcional, e `caption.ts` trata a ausência como `'mercadolivre'` (comportamento atual preservado).

Este achado foi descoberto durante o brainstorming: `src/lib/social/caption.ts` tinha uma hashtag fixa `#mercadolivre` que ficaria incorreta em posts de produtos Shopee — o spec original assumia (incorretamente) que nenhuma mudança nas redes sociais seria necessária.

- [ ] **Step 1: Escrever o teste que falha**

Adicionar a `src/lib/social/caption.test.ts` (arquivo já existe, adicionar ao final do `describe`, antes do `});` de fechamento):

```typescript
  it('usa #shopee na legenda quando o produto vem da Shopee', () => {
    const text = buildSocialCaption(
      { title: 'Produto Y', price: 79.9, imageUrl: 'https://x.com/img.jpg', marketplace: 'shopee' },
      'https://s.shopee.com.br/abc123',
    );
    expect(text).toBe(
      'Produto Y\n\n🏷️ R$79,90\n\n🔗 Confira: https://s.shopee.com.br/abc123 (também no link da bio)\n\n#promocao #oferta #shopee #desconto',
    );
  });

  it('usa #mercadolivre na legenda quando o produto não informa marketplace (default)', () => {
    const text = buildSocialCaption(
      { title: 'Produto Z', price: 50, imageUrl: 'https://x.com/img.jpg' },
      'https://meli.la/xyz',
    );
    expect(text).toBe(
      'Produto Z\n\n🏷️ R$50,00\n\n🔗 Confira: https://meli.la/xyz (também no link da bio)\n\n#promocao #oferta #mercadolivre #desconto',
    );
  });
```

- [ ] **Step 2: Rodar os testes e confirmar que falham**

Run: `npx vitest run src/lib/social/caption.test.ts`
Expected: FAIL — o teste do Shopee falha porque `marketplace` não existe no tipo `Product` ainda (erro de tipo/TypeScript) e a hashtag ainda é sempre `#mercadolivre`.

- [ ] **Step 3: Criar o módulo de tipos compartilhado**

Criar `src/lib/marketplace/types.ts`:

```typescript
export interface Product {
  title: string;
  price: number;
  imageUrl: string;
  marketplace?: 'mercadolivre' | 'shopee';
}
```

- [ ] **Step 4: Atualizar `affiliateLink.ts` pra importar `Product` do novo módulo**

Em `src/lib/mercadolivre/affiliateLink.ts`, substituir a declaração local da interface `Product` por um import e re-export (mantém compatibilidade com todo código que já importa `Product` daqui — `pipeline.ts`, `template.ts`, `caption.ts`, `webhook/route.ts` continuam funcionando sem quebrar até serem migrados nos steps seguintes desta mesma task):

```typescript
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Sandbox } from '@vercel/sandbox';
import ms from 'ms';
import { InvalidLinkError, ProductNotFoundError, SessionExpiredError } from '../pipeline';
import { loadSession } from '../session/sessionStore';
import type { Product } from '../marketplace/types';

export type { Product };

export interface AffiliateResult {
  product: Product;
  affiliateLink: string;
}
```

(Remove a antiga declaração `export interface Product { title: string; price: number; imageUrl: string; }` que existia no topo do arquivo — o resto do arquivo, a partir de `const SANDBOX_NAME = ...`, não muda nesta task.)

- [ ] **Step 5: Atualizar os imports de `Product` nos consumidores pra apontar pro novo módulo**

Em `src/lib/pipeline.ts:1`, trocar:
```typescript
import type { Product } from './mercadolivre/affiliateLink';
```
por:
```typescript
import type { Product } from './marketplace/types';
```

Em `src/lib/content/template.ts:1`, trocar:
```typescript
import type { Product } from '../mercadolivre/affiliateLink';
```
por:
```typescript
import type { Product } from '../marketplace/types';
```

Em `src/app/api/webhook/route.ts:3`, trocar:
```typescript
import type { Product } from '@/lib/mercadolivre/affiliateLink';
```
por:
```typescript
import type { Product } from '@/lib/marketplace/types';
```

- [ ] **Step 6: Atualizar `caption.ts` pra importar do novo módulo e usar a hashtag dinâmica**

Substituir `src/lib/social/caption.ts` inteiro por:

```typescript
import type { Product } from '../marketplace/types';

function formatPrice(value: number): string {
  return value.toLocaleString('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function buildHashtags(marketplace: Product['marketplace']): string {
  const marketplaceTag = marketplace === 'shopee' ? '#shopee' : '#mercadolivre';
  return `#promocao #oferta ${marketplaceTag} #desconto`;
}

export function buildSocialCaption(
  product: Product,
  affiliateLink: string,
  coupon?: string,
  discountedPrice?: number,
): string {
  const linkLine = `🔗 Confira: ${affiliateLink} (também no link da bio)`;
  const hashtags = buildHashtags(product.marketplace);

  if (typeof discountedPrice === 'number') {
    const regularPrice = formatPrice(product.price);
    const discounted = formatPrice(discountedPrice);
    const priceLine = `🔥 De R$${regularPrice} por R$${discounted}`;
    const couponLine = coupon ? `\n\n🎟️ Cupom: ${coupon}` : '';
    return `${product.title}\n\n${priceLine}${couponLine}\n\n${linkLine}\n\n${hashtags}`;
  }

  const price = formatPrice(product.price);
  return `${product.title}\n\n🏷️ R$${price}\n\n${linkLine}\n\n${hashtags}`;
}
```

- [ ] **Step 7: Rodar os testes e confirmar que passam**

Run: `npx vitest run src/lib/social/caption.test.ts`
Expected: PASS (6 testes — 4 já existentes + 2 novos)

Run: `npm test`
Expected: PASS — suíte inteira (nenhum outro arquivo deveria ter quebrado, já que `marketplace` é opcional).

Run: `npm run typecheck`
Expected: sem erros.

- [ ] **Step 8: Commit**

```bash
git add src/lib/marketplace/types.ts src/lib/mercadolivre/affiliateLink.ts src/lib/pipeline.ts src/lib/content/template.ts src/app/api/webhook/route.ts src/lib/social/caption.ts src/lib/social/caption.test.ts
git commit -m "feat: mover Product para modulo compartilhado e tornar hashtag da legenda dinamica por marketplace"
```

---

### Task 2: Reestruturar o script Playwright pra ser testável + assinatura SHA256 da Shopee

**Files:**
- Modify: `src/lib/mercadolivre/generate-link.playwright.mjs`
- Test: `src/lib/mercadolivre/generate-link.playwright.test.ts`

**Interfaces:**
- Consumes: nada de tasks anteriores.
- Produces: `export function calculateShopeeSignature(appId: string, timestamp: number, payload: string, secret: string): string` — retorna a assinatura em hex, usada pela Task 3 (chamada real à API) e testável isoladamente aqui. Também produz a estrutura `main()` que a Task 3 vai estender.

O script hoje (`generate-link.playwright.mjs`) executa tudo em código de nível superior (`const [, , productLink] = process.argv; ... const browser = await chromium.launch(...)`), o que significa que **importar o arquivo** (como um teste Vitest precisa fazer pra testar `calculateShopeeSignature`) dispara a execução inteira do script — abre browser, tenta ler `/vercel/sandbox/session.json` (que não existe fora da Sandbox), e crasha. Esta task move essa execução pra dentro de uma função `main()`, chamada só quando o arquivo roda diretamente (`node generate-link.mjs ...`), não quando é importado.

- [ ] **Step 1: Escrever o teste que falha**

Criar `src/lib/mercadolivre/generate-link.playwright.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import { calculateShopeeSignature } from './generate-link.playwright.mjs';

describe('calculateShopeeSignature', () => {
  it('calcula SHA256 hex de appId + timestamp + payload + secret', async () => {
    // Vetor de teste conhecido: sha256("app1" + "1700000000" + '{"a":1}' + "secret123")
    // calculado manualmente via node:crypto pra confirmar o algoritmo, não um valor
    // oficial da Shopee (a documentação pública não publica vetores de teste).
    const { createHash } = await import('node:crypto');
    const expected = createHash('sha256')
      .update('app1' + '1700000000' + '{"a":1}' + 'secret123')
      .digest('hex');

    const result = calculateShopeeSignature('app1', 1700000000, '{"a":1}', 'secret123');

    expect(result).toBe(expected);
    expect(result).toMatch(/^[0-9a-f]{64}$/);
  });

  it('produz assinaturas diferentes pra payloads diferentes (sensibilidade ao conteúdo)', () => {
    const sig1 = calculateShopeeSignature('app1', 1700000000, '{"a":1}', 'secret123');
    const sig2 = calculateShopeeSignature('app1', 1700000000, '{"a":2}', 'secret123');

    expect(sig1).not.toBe(sig2);
  });
});
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

Run: `npx vitest run src/lib/mercadolivre/generate-link.playwright.test.ts`
Expected: FAIL — `calculateShopeeSignature is not a function` (o arquivo `.mjs` ainda não exporta nada, e importar hoje tentaria rodar o script inteiro).

- [ ] **Step 3: Reestruturar o script**

Substituir `src/lib/mercadolivre/generate-link.playwright.mjs` inteiro por (a Task 3 vai estender o corpo de `main()` — por ora, o comportamento é idêntico ao script original, só reorganizado):

```javascript
// Roda DENTRO da Vercel Sandbox (node generate-link.mjs <link-produto>).
// Usa a sessão salva em /vercel/sandbox/session.json (storageState do Playwright).
//
// Faz três coisas na mesma sessão de browser:
//   0. Navega até o link recebido e segue qualquer redirect (HTTP normal ou
//      client-side via JS — comum em encurtador/rastreador de terceiro tipo
//      go.promozone.ai) até o destino final, e só então confere se caiu
//      mesmo numa página do Mercado Livre ou da Shopee. A partir daqui usa a
//      URL resolvida (page.url()), não o link original recebido.
//   1. Extrai título/preço/imagem do HTML da página do produto.
//      (a API pública api.mercadolibre.com/items/{id} passou a exigir OAuth
//      e não serve mais pra isso — descoberto em validação manual real.)
//   2. Gera o link de afiliado:
//      - Mercado Livre: visita o gerador de link de afiliado
//        (mercadolivre.com.br/afiliados/linkbuilder#hub, só acessível pra
//        conta já aprovada no Programa de Afiliados) e gera o link.
//      - Shopee: chama a API oficial de afiliados (GraphQL, assinada com
//        SHA256) via fetch, sem precisar de um segundo browser.
//
// Imprime em stdout um JSON: {"title","price","imageUrl","marketplace","affiliateLink"}.
//
// O Mercado Livre bloqueia Chromium headless "puro" com uma página de erro
// genérica ("Hubo un error accediendo a esta pagina..."), mesmo com sessão
// válida — por isso o context abaixo usa user-agent real, esconde
// navigator.webdriver e passa --disable-blink-features=AutomationControlled.
// Sem isso, TODA navegação falha, não só a do link builder.
//
// --no-sandbox e --disable-setuid-sandbox são necessários porque o usuário
// vercel-sandbox não tem privilégio de kernel pro sandbox interno do próprio
// Chromium; sem essas flags o browser fecha sozinho logo após abrir
// ("Target page, context or browser has been closed").

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright';

// Assinatura exigida pela Shopee Affiliate Open API: header
// `Authorization: SHA256 Credential={appId}, Timestamp={timestamp}, Signature={signature}`,
// onde signature = SHA256(appId + timestamp + payload + secret) em hex,
// timestamp em segundos Unix. Extraída como função pura pra ser testável
// isoladamente (ver generate-link.playwright.test.ts) sem precisar rodar o
// resto do script (que depende de Playwright + sessão real).
export function calculateShopeeSignature(appId, timestamp, payload, secret) {
  return createHash('sha256')
    .update(`${appId}${timestamp}${payload}${secret}`)
    .digest('hex');
}

async function main() {
  const [, , productLink] = process.argv;

  if (!productLink) {
    console.error('Uso: node generate-link.mjs <link-produto>');
    process.exit(1);
  }

  const storageState = JSON.parse(readFileSync('/vercel/sandbox/session.json', 'utf8'));

  const browser = await chromium.launch({
    args: [
      '--disable-blink-features=AutomationControlled',
      '--no-sandbox',
      '--disable-setuid-sandbox',
    ],
  });
  const context = await browser.newContext({
    storageState,
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    viewport: { width: 1280, height: 900 },
    locale: 'pt-BR',
  });
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  });
  const page = await context.newPage();

  try {
    // 0. Resolve redirect (HTTP ou client-side) e confere destino final
    await page.goto(productLink, { waitUntil: 'networkidle', timeout: 45000 }).catch(() => {});
    await page.waitForTimeout(1500);

    let resolvedUrl = page.url();
    let resolvedHost;
    try {
      resolvedHost = new URL(resolvedUrl).hostname;
    } catch {
      resolvedHost = '';
    }
    const isMercadoLivre =
      /(^|\.)mercadolivre\.com\.br$/i.test(resolvedHost) || /(^|\.)mercadolibre\.com$/i.test(resolvedHost);

    if (!isMercadoLivre) {
      console.error(`LINK_NOT_MERCADOLIVRE (resolvido para: ${resolvedUrl})`);
      process.exit(1);
    }

    // 0.5. Encurtadores de terceiro (ex: go.promozone.ai) às vezes caem numa
    // página de "Perfil Social" do afiliado no Mercado Livre em vez de ir
    // direto pro produto — essa página tem um botão "Ir para produto" que
    // leva pra ficha real (descoberto em validação manual real, 2026-07-29).
    // Se existir, segue esse link antes de tentar extrair título/preço.
    const irParaProdutoLink = page.getByRole('link', { name: /ir para produto/i }).first();
    const productHref = await irParaProdutoLink.getAttribute('href', { timeout: 5000 }).catch(() => null);
    if (productHref) {
      await page.goto(productHref, { waitUntil: 'networkidle', timeout: 45000 }).catch(() => {});
      await page.waitForTimeout(1500);
      resolvedUrl = page.url();
    }

    // 0.6. Cupons de loja/categoria inteira (sem produto único vinculado) às
    // vezes vêm com um link genérico pro índice de listas curadas do afiliado
    // (ex: /social/promozonevip/lists) em vez de um produto — essa página não
    // tem título/preço/imagem de produto pra extrair (confirmado em validação
    // manual real, 2026-07-31). Detecta esse formato antes de tentar extrair
    // e reporta um motivo específico, em vez de cair no PRODUCT_NOT_FOUND
    // genérico (que soa como falha inesperada, quando na verdade é esperado).
    if (/\/social\/[^/]+\/lists\/?$/i.test(new URL(resolvedUrl).pathname)) {
      console.error(`PRODUCT_LIST_LINK (resolvido para: ${resolvedUrl})`);
      process.exit(1);
    }

    // 1. Dados do produto (já estamos na página, resolvida acima)
    const title = await page.locator('h1').first().innerText({ timeout: 15000 }).catch(() => null);

    const priceMeta = await page
      .locator('meta[itemprop="price"], meta[property="product:price:amount"]')
      .first()
      .getAttribute('content')
      .catch(() => null);
    const price = priceMeta ? Number.parseFloat(priceMeta) : NaN;

    const imageUrl = await page
      .locator('meta[property="og:image"]')
      .first()
      .getAttribute('content')
      .catch(() => null);

    if (!title || Number.isNaN(price) || !imageUrl) {
      console.error(
        `PRODUCT_NOT_FOUND (title=${JSON.stringify(title)}, price=${priceMeta}, imageUrl=${JSON.stringify(imageUrl)})`,
      );
      process.exit(1);
    }

    // 2. Link de afiliado
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
    await urlField.fill(resolvedUrl);
    await page.waitForTimeout(500);

    const gerarBtn = page.getByRole('button', { name: 'Gerar' });
    const stillDisabled = await gerarBtn.evaluate((el) => el.hasAttribute('disabled')).catch(() => true);
    if (stillDisabled) {
      // Fallback: repete o preenchimento caso o primeiro tenha corrido antes
      // da hidratação religar o handler.
      await urlField.fill('');
      await urlField.fill(resolvedUrl);
      await page.waitForTimeout(1500);
    }

    await gerarBtn.click({ timeout: 30000 });

    const affiliateLink = await page.locator('#textfield-copyLink-1').inputValue({ timeout: 15000 });

    if (!affiliateLink || !affiliateLink.startsWith('http')) {
      throw new Error(`Campo de resultado sem link válido: "${affiliateLink}"`);
    }

    console.log(
      JSON.stringify({ title, price, imageUrl, marketplace: 'mercadolivre', affiliateLink: affiliateLink.trim() }),
    );
  } catch (err) {
    console.error(String(err));
    process.exit(1);
  } finally {
    await browser.close();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
```

- [ ] **Step 4: Rodar o teste e confirmar que passa**

Run: `npx vitest run src/lib/mercadolivre/generate-link.playwright.test.ts`
Expected: PASS (2 testes)

- [ ] **Step 5: Confirmar que o comportamento do script rodando direto não mudou**

Run: `npm test`
Expected: PASS — suíte inteira (o teste de `affiliateLink.test.ts` mocka `Sandbox.runCommand`, então não executa o `.mjs` de verdade; ele só confirma que nada mais quebrou).

Run: `npm run typecheck`
Expected: sem erros.

- [ ] **Step 6: Commit**

```bash
git add src/lib/mercadolivre/generate-link.playwright.mjs src/lib/mercadolivre/generate-link.playwright.test.ts
git commit -m "refactor: mover execucao do script Playwright pra dentro de main() e extrair assinatura SHA256 da Shopee testavel"
```

---

### Task 3: Detectar marketplace, extrair produto da Shopee e gerar o link via API oficial

**Files:**
- Modify: `src/lib/mercadolivre/generate-link.playwright.mjs`

**Interfaces:**
- Consumes: `calculateShopeeSignature(appId, timestamp, payload, secret)` (Task 2, mesmo arquivo).
- Produces: o script agora aceita `SHOPEE_APP_ID`/`SHOPEE_SECRET_KEY` como variáveis de ambiente (lidas via `process.env`, passadas pela Task 4 através de `sandbox.runCommand({..., env: {...}})`). Em caso de link Shopee, imprime o mesmo formato de stdout de sempre, com `marketplace: 'shopee'`. Novo marcador de erro em stderr: `MARKETPLACE_NOT_SUPPORTED` (substitui `LINK_NOT_MERCADOLIVRE`), e `SHOPEE_CREDENTIALS_MISSING`, `SHOPEE_API_ERROR` — consumidos pela Task 4 (`affiliateLink.ts`).

Este script não tem cobertura de teste automatizado (mesma limitação já aceita pro resto do arquivo — depende de Playwright, de uma sessão de browser real e do layout ao vivo do site da Shopee). A validação é manual, com um link real, feita durante a configuração (Task 4 + runbook).

- [ ] **Step 1: Substituir a checagem de hostname único por detecção de marketplace**

Em `src/lib/mercadolivre/generate-link.playwright.mjs`, dentro de `main()`, substituir o bloco:

```javascript
    const isMercadoLivre =
      /(^|\.)mercadolivre\.com\.br$/i.test(resolvedHost) || /(^|\.)mercadolibre\.com$/i.test(resolvedHost);

    if (!isMercadoLivre) {
      console.error(`LINK_NOT_MERCADOLIVRE (resolvido para: ${resolvedUrl})`);
      process.exit(1);
    }
```

por:

```javascript
    const isMercadoLivre =
      /(^|\.)mercadolivre\.com\.br$/i.test(resolvedHost) || /(^|\.)mercadolibre\.com$/i.test(resolvedHost);
    const isShopee = /(^|\.)shopee\.com\.br$/i.test(resolvedHost);

    if (!isMercadoLivre && !isShopee) {
      console.error(`MARKETPLACE_NOT_SUPPORTED (resolvido para: ${resolvedUrl})`);
      process.exit(1);
    }
```

- [ ] **Step 2: Isolar o fluxo específico do Mercado Livre por trás de um `if`, e adicionar o fluxo da Shopee**

O bloco 0.5 ("Ir para produto"), o bloco 0.6 (índice de listas) e o passo 2 (gerador de link via painel) só fazem sentido pro Mercado Livre. Envolver esses blocos, e adicionar o ramo Shopee logo depois da extração de título/preço/imagem (passo 1, que os dois marketplaces compartilham — a extração de meta tags funciona igual pros dois).

Substituir do comentário `// 0.5.` até o fechamento do `try` (linha `console.log(JSON.stringify({...}));`) por:

```javascript
    if (isMercadoLivre) {
      // 0.5. Encurtadores de terceiro (ex: go.promozone.ai) às vezes caem numa
      // página de "Perfil Social" do afiliado no Mercado Livre em vez de ir
      // direto pro produto — essa página tem um botão "Ir para produto" que
      // leva pra ficha real (descoberto em validação manual real, 2026-07-29).
      // Se existir, segue esse link antes de tentar extrair título/preço.
      const irParaProdutoLink = page.getByRole('link', { name: /ir para produto/i }).first();
      const productHref = await irParaProdutoLink.getAttribute('href', { timeout: 5000 }).catch(() => null);
      if (productHref) {
        await page.goto(productHref, { waitUntil: 'networkidle', timeout: 45000 }).catch(() => {});
        await page.waitForTimeout(1500);
        resolvedUrl = page.url();
      }

      // 0.6. Cupons de loja/categoria inteira (sem produto único vinculado) às
      // vezes vêm com um link genérico pro índice de listas curadas do afiliado
      // (ex: /social/promozonevip/lists) em vez de um produto — essa página não
      // tem título/preço/imagem de produto pra extrair (confirmado em validação
      // manual real, 2026-07-31). Detecta esse formato antes de tentar extrair
      // e reporta um motivo específico, em vez de cair no PRODUCT_NOT_FOUND
      // genérico (que soa como falha inesperada, quando na verdade é esperado).
      if (/\/social\/[^/]+\/lists\/?$/i.test(new URL(resolvedUrl).pathname)) {
        console.error(`PRODUCT_LIST_LINK (resolvido para: ${resolvedUrl})`);
        process.exit(1);
      }
    }

    // 1. Dados do produto (já estamos na página, resolvida acima) — mesmo
    // padrão de meta tags pros dois marketplaces (Open Graph + itemprop).
    const title = await page.locator('h1').first().innerText({ timeout: 15000 }).catch(() => null);

    const priceMeta = await page
      .locator('meta[itemprop="price"], meta[property="product:price:amount"]')
      .first()
      .getAttribute('content')
      .catch(() => null);
    const price = priceMeta ? Number.parseFloat(priceMeta) : NaN;

    const imageUrl = await page
      .locator('meta[property="og:image"]')
      .first()
      .getAttribute('content')
      .catch(() => null);

    if (!title || Number.isNaN(price) || !imageUrl) {
      console.error(
        `PRODUCT_NOT_FOUND (title=${JSON.stringify(title)}, price=${priceMeta}, imageUrl=${JSON.stringify(imageUrl)})`,
      );
      process.exit(1);
    }

    if (isShopee) {
      // 2 (Shopee). Gera o link de afiliado via API oficial (GraphQL,
      // assinada com SHA256) — não precisa de um segundo browser nem de
      // sessão logada, só das credenciais fixas do app de afiliado.
      const appId = process.env.SHOPEE_APP_ID;
      const secretKey = process.env.SHOPEE_SECRET_KEY;
      if (!appId || !secretKey) {
        console.error('SHOPEE_CREDENTIALS_MISSING');
        process.exit(1);
      }

      const timestamp = Math.floor(Date.now() / 1000);
      const query =
        'mutation generateShortLink($input: ShortLinkInput!) { generateShortLink(input: $input) { shortLink } }';
      const variables = { input: { originUrl: resolvedUrl, subIds: ['promopost'] } };
      const payload = JSON.stringify({ query, variables });
      const signature = calculateShopeeSignature(appId, timestamp, payload, secretKey);

      const shopeeRes = await fetch('https://open-api.affiliate.shopee.com.br/graphql', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `SHA256 Credential=${appId}, Timestamp=${timestamp}, Signature=${signature}`,
        },
        body: payload,
      });
      const shopeeJson = await shopeeRes.json().catch(() => null);
      const affiliateLink = shopeeJson?.data?.generateShortLink?.shortLink;

      if (!shopeeRes.ok || shopeeJson?.errors || !affiliateLink) {
        console.error(`SHOPEE_API_ERROR (${JSON.stringify(shopeeJson?.errors ?? shopeeRes.status)})`);
        process.exit(1);
      }

      console.log(JSON.stringify({ title, price, imageUrl, marketplace: 'shopee', affiliateLink }));
      return;
    }

    // 2 (Mercado Livre). Visita o gerador de link de afiliado (só acessível
    // pra conta já aprovada no Programa de Afiliados) e gera o link.
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
    await urlField.fill(resolvedUrl);
    await page.waitForTimeout(500);

    const gerarBtn = page.getByRole('button', { name: 'Gerar' });
    const stillDisabled = await gerarBtn.evaluate((el) => el.hasAttribute('disabled')).catch(() => true);
    if (stillDisabled) {
      // Fallback: repete o preenchimento caso o primeiro tenha corrido antes
      // da hidratação religar o handler.
      await urlField.fill('');
      await urlField.fill(resolvedUrl);
      await page.waitForTimeout(1500);
    }

    await gerarBtn.click({ timeout: 30000 });

    const affiliateLink = await page.locator('#textfield-copyLink-1').inputValue({ timeout: 15000 });

    if (!affiliateLink || !affiliateLink.startsWith('http')) {
      throw new Error(`Campo de resultado sem link válido: "${affiliateLink}"`);
    }

    console.log(
      JSON.stringify({ title, price, imageUrl, marketplace: 'mercadolivre', affiliateLink: affiliateLink.trim() }),
    );
```

Note que `resolvedHost` já foi declarado antes deste trecho (no bloco 0, não alterado por esta task) — a variável `let resolvedUrl` também já existe. Não duplique essas declarações.

- [ ] **Step 3: Revisão cuidadosa do arquivo completo**

Leia o arquivo `generate-link.playwright.mjs` do início ao fim depois da edição, confirmando: `isMercadoLivre` e `isShopee` declarados uma única vez; o `if (isMercadoLivre) { ... }` do passo 0.5/0.6 fecha corretamente antes do passo 1; o `if (isShopee) { ... return; }` fecha antes do passo 2 do Mercado Livre; nenhum código do Mercado Livre roda quando `isShopee` é `true` (o `return` early garante isso); o `catch (err)` e o `finally { await browser.close(); }` do `main()` (Task 2) continuam envolvendo todo o bloco, incluindo o novo trecho Shopee.

- [ ] **Step 4: Rodar a suíte e confirmar que nada quebrou**

Run: `npm test`
Expected: PASS — suíte inteira. Nenhum teste automatizado cobre o novo trecho Shopee diretamente (só a assinatura, já coberta na Task 2) — isso é esperado, mesma limitação do resto do arquivo.

Run: `npm run typecheck`
Expected: sem erros (arquivo `.mjs` não é verificado por `tsc`, mas confirma que nada em TS foi afetado).

- [ ] **Step 5: Commit**

```bash
git add src/lib/mercadolivre/generate-link.playwright.mjs
git commit -m "feat: detectar marketplace Shopee e gerar link de afiliado via API oficial assinada"
```

---

### Task 4: Integrar no orquestrador TS, variáveis de ambiente e runbook

**Files:**
- Modify: `src/lib/mercadolivre/affiliateLink.ts`
- Modify: `src/lib/mercadolivre/affiliateLink.test.ts`
- Modify: `.env.example`
- Modify: `docs/runbook.md`

**Interfaces:**
- Consumes: os novos marcadores de stderr do script (`MARKETPLACE_NOT_SUPPORTED`, `SHOPEE_CREDENTIALS_MISSING`, `SHOPEE_API_ERROR` — Task 3) e o campo `marketplace` no JSON de stdout (Tasks 2 e 3).
- Produces: `fetchProductAndAffiliateLink` (assinatura já existente, sem mudança) agora passa `SHOPEE_APP_ID`/`SHOPEE_SECRET_KEY` como env vars pro comando da Sandbox, e mapeia os novos erros pras classes já existentes (`InvalidLinkError`, erro genérico).

- [ ] **Step 1: Escrever os testes que falham**

Em `src/lib/mercadolivre/affiliateLink.test.ts`, primeiro renomear o teste existente que hoje cobre `LINK_NOT_MERCADOLIVRE` (esse marcador não existe mais — foi substituído por `MARKETPLACE_NOT_SUPPORTED` na Task 3). Substituir:

```typescript
  it('lança InvalidLinkError quando o script reporta LINK_NOT_MERCADOLIVRE no stderr', async () => {
    runCommandMock.mockResolvedValue({
      exitCode: 1,
      stdout: async () => '',
      stderr: async () => 'LINK_NOT_MERCADOLIVRE (resolvido para: https://exemplo.com/outra-coisa)',
    });

    await expect(
      fetchProductAndAffiliateLink('https://go.promozone.ai/mercadolivre/PwQ6x6'),
    ).rejects.toThrow('Link não leva a uma página do Mercado Livre');
  });
```

por:

```typescript
  it('lança InvalidLinkError quando o script reporta MARKETPLACE_NOT_SUPPORTED no stderr', async () => {
    runCommandMock.mockResolvedValue({
      exitCode: 1,
      stdout: async () => '',
      stderr: async () => 'MARKETPLACE_NOT_SUPPORTED (resolvido para: https://exemplo.com/outra-coisa)',
    });

    await expect(
      fetchProductAndAffiliateLink('https://go.promozone.ai/mercadolivre/PwQ6x6'),
    ).rejects.toThrow('Link não leva a um marketplace suportado');
  });
```

Depois, adicionar ao final do `describe('fetchProductAndAffiliateLink', ...)` (antes do `});` de fechamento):

```typescript
  it('retorna produto da Shopee com marketplace correto quando o script termina com sucesso', async () => {
    runCommandMock.mockResolvedValue({
      exitCode: 0,
      stdout: async () =>
        `${JSON.stringify({
          title: 'Fone Bluetooth Shopee',
          price: 59.9,
          imageUrl: 'https://down-br.img.susercontent.com/img.jpg',
          marketplace: 'shopee',
          affiliateLink: 'https://s.shopee.com.br/abc123',
        })}\n`,
      stderr: async () => '',
    });

    const result = await fetchProductAndAffiliateLink('https://shopee.com.br/produto-x');

    expect(result).toEqual({
      product: {
        title: 'Fone Bluetooth Shopee',
        price: 59.9,
        imageUrl: 'https://down-br.img.susercontent.com/img.jpg',
        marketplace: 'shopee',
      },
      affiliateLink: 'https://s.shopee.com.br/abc123',
    });
  });

  it('lança erro quando o script reporta SHOPEE_CREDENTIALS_MISSING no stderr', async () => {
    runCommandMock.mockResolvedValue({
      exitCode: 1,
      stdout: async () => '',
      stderr: async () => 'SHOPEE_CREDENTIALS_MISSING',
    });

    await expect(
      fetchProductAndAffiliateLink('https://shopee.com.br/produto-x'),
    ).rejects.toThrow('Variáveis de ambiente da Shopee ausentes');
  });

  it('lança erro quando o script reporta SHOPEE_API_ERROR no stderr', async () => {
    runCommandMock.mockResolvedValue({
      exitCode: 1,
      stdout: async () => '',
      stderr: async () => 'SHOPEE_API_ERROR ({"message":"invalid signature"})',
    });

    await expect(
      fetchProductAndAffiliateLink('https://shopee.com.br/produto-x'),
    ).rejects.toThrow('Falha ao gerar link de afiliado da Shopee');
  });

  it('passa SHOPEE_APP_ID e SHOPEE_SECRET_KEY como env vars pro comando da sandbox', async () => {
    vi.stubEnv('SHOPEE_APP_ID', 'app123');
    vi.stubEnv('SHOPEE_SECRET_KEY', 'secret456');
    runCommandMock.mockResolvedValue({
      exitCode: 0,
      stdout: async () =>
        `${JSON.stringify({
          title: 'Produto',
          price: 10,
          imageUrl: 'https://x.com/img.jpg',
          marketplace: 'shopee',
          affiliateLink: 'https://s.shopee.com.br/x',
        })}\n`,
      stderr: async () => '',
    });

    await fetchProductAndAffiliateLink('https://shopee.com.br/produto-x');

    expect(runCommandMock).toHaveBeenCalledWith(
      expect.objectContaining({
        env: expect.objectContaining({ SHOPEE_APP_ID: 'app123', SHOPEE_SECRET_KEY: 'secret456' }),
      }),
    );

    vi.unstubAllEnvs();
  });
```

- [ ] **Step 2: Rodar os testes e confirmar que falham**

Run: `npx vitest run src/lib/mercadolivre/affiliateLink.test.ts`
Expected: FAIL — o teste renomeado falha (mensagem antiga ainda é "Link não leva a uma página do Mercado Livre"), os 4 novos testes falham (comportamento não implementado ainda).

- [ ] **Step 3: Implementar**

Ler `src/lib/mercadolivre/affiliateLink.ts` primeiro (a Task 1 já modificou o topo do arquivo — confirme que o import de `Product`/`AffiliateResult` está como deixado por ela antes de editar o restante).

Substituir o bloco de mapeamento de erros e a chamada de `runCommand` dentro de `fetchProductAndAffiliateLink`:

```typescript
export async function fetchProductAndAffiliateLink(productLink: string): Promise<AffiliateResult> {
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
    env: {
      SHOPEE_APP_ID: process.env.SHOPEE_APP_ID ?? '',
      SHOPEE_SECRET_KEY: process.env.SHOPEE_SECRET_KEY ?? '',
    },
  });

  if (result.exitCode !== 0) {
    const stderr = await result.stderr();
    if (stderr.includes('SESSION_EXPIRED')) {
      throw new SessionExpiredError();
    }
    if (stderr.includes('PRODUCT_NOT_FOUND')) {
      throw new ProductNotFoundError(`Produto não encontrado na página do Mercado Livre: ${stderr.slice(0, 300)}`);
    }
    if (stderr.includes('MARKETPLACE_NOT_SUPPORTED')) {
      throw new InvalidLinkError(`Link não leva a um marketplace suportado: ${stderr.slice(0, 300)}`);
    }
    if (stderr.includes('PRODUCT_LIST_LINK')) {
      throw new InvalidLinkError(
        `Link aponta pro índice de listas do afiliado, sem produto único associado: ${stderr.slice(0, 300)}`,
      );
    }
    if (stderr.includes('SHOPEE_CREDENTIALS_MISSING')) {
      throw new Error('Variáveis de ambiente da Shopee ausentes: SHOPEE_APP_ID, SHOPEE_SECRET_KEY');
    }
    if (stderr.includes('SHOPEE_API_ERROR')) {
      throw new Error(`Falha ao gerar link de afiliado da Shopee: ${stderr.slice(0, 300)}`);
    }
    throw new Error(`Falha ao gerar link de afiliado: ${stderr.slice(0, 500)}`);
  }

  const stdout = (await result.stdout()).trim();
  let parsed: {
    title?: unknown;
    price?: unknown;
    imageUrl?: unknown;
    marketplace?: unknown;
    affiliateLink?: unknown;
  };
  try {
    parsed = JSON.parse(stdout);
  } catch {
    throw new Error(`Saída inesperada do script de afiliado: ${stdout.slice(0, 200)}`);
  }

  if (
    typeof parsed.title !== 'string' ||
    typeof parsed.price !== 'number' ||
    typeof parsed.imageUrl !== 'string' ||
    typeof parsed.affiliateLink !== 'string' ||
    !parsed.affiliateLink.startsWith('http')
  ) {
    throw new Error(`Saída inesperada do script de afiliado: ${stdout.slice(0, 200)}`);
  }

  const marketplace = parsed.marketplace === 'shopee' ? 'shopee' : 'mercadolivre';

  return {
    product: { title: parsed.title, price: parsed.price, imageUrl: parsed.imageUrl, marketplace },
    affiliateLink: parsed.affiliateLink,
  };
}
```

Note: o teste já existente `'retorna produto e link de afiliado quando o script termina com sucesso'` (caminho feliz do Mercado Livre) espera `result.product` **sem** o campo `marketplace` no `toEqual`. Como o parse agora sempre inclui `marketplace: 'mercadolivre'` por padrão (linha `const marketplace = parsed.marketplace === 'shopee' ? 'shopee' : 'mercadolivre';`), esse teste existente vai passar a falhar — atualize-o também, adicionando `marketplace: 'mercadolivre'` ao objeto `product` esperado:

```typescript
    expect(result).toEqual({
      product: {
        title: 'Fone de Ouvido Bluetooth XYZ',
        price: 149.9,
        imageUrl: 'https://http2.mlstatic.com/img.jpg',
        marketplace: 'mercadolivre',
      },
      affiliateLink: 'https://meli.la/abc123',
    });
```

- [ ] **Step 4: Rodar os testes e confirmar que passam**

Run: `npx vitest run src/lib/mercadolivre/affiliateLink.test.ts`
Expected: PASS (11 testes — 6 já existentes, com 1 ajustado, + 5 novos... confira a contagem exata ao rodar; o importante é 0 failures)

Run: `npm test`
Expected: PASS — suíte inteira.

Run: `npm run typecheck`
Expected: sem erros.

- [ ] **Step 5: Documentar variáveis de ambiente**

Adicionar ao final de `.env.example`:

```bash
# App de afiliados da Shopee (affiliate.shopee.com.br > seção Open API) —
# App ID e Secret Key usados pra assinar as chamadas à API oficial.
SHOPEE_APP_ID=
SHOPEE_SECRET_KEY=
```

- [ ] **Step 6: Documentar no runbook**

Adicionar uma nova seção `## 12. Shopee (opcional, sub-projeto separado)` em `docs/runbook.md`, depois da seção 11 (TikTok) existente:

```markdown
## 12. Shopee (opcional, sub-projeto separado)

Cobre a captura automática de links da Shopee no mesmo canal Telegram já monitorado, publicando no blog e nas redes sociais igual já acontece com o Mercado Livre (ver `docs/superpowers/specs/2026-07-31-shopee-marketplace-design.md`).

Diferente do Mercado Livre, a Shopee **não exige sessão logada nem bootstrap manual** — só credenciais fixas de app de afiliado.

### 12.1 Obter as credenciais

1. Acesse affiliate.shopee.com.br, logado na conta de afiliado já aprovada.
2. Procure a seção **"Open API"** (pode estar em "Ferramentas" ou similar — a interface muda).
3. Gere (ou copie, se já existir) o **App ID** e o **Secret Key** — vão em `SHOPEE_APP_ID`/`SHOPEE_SECRET_KEY`.

### 12.2 Verificar o domínio da API

O código chama `https://open-api.affiliate.shopee.com.br/graphql`. Esse domínio foi inferido de documentação pública de terceiros (a documentação oficial da Shopee é escassa e majoritariamente atrás de login) — **confirme dentro do painel de Open API** se esse é o endpoint correto pra sua conta antes do primeiro teste real. Se for diferente, ajuste a URL em `src/lib/mercadolivre/generate-link.playwright.mjs` (procure por `open-api.affiliate.shopee`).

### 12.3 Teste manual

Depois de configurar `SHOPEE_APP_ID`/`SHOPEE_SECRET_KEY` na Vercel e fazer o deploy, disparar o webhook (seção 6) com um link de produto real da Shopee (ou um link de encurtador que resolva pra um) e conferir a resposta:

```json
{ "postUrl": "..." }
```

Se falhar, confira os logs (`vercel logs`) — o erro real da chamada assinada aparece no stderr do script (marcador `SHOPEE_API_ERROR`), incluindo a resposta de erro devolvida pela Shopee.

### 12.4 Se algo falhar

- `Variáveis de ambiente da Shopee ausentes: SHOPEE_APP_ID, SHOPEE_SECRET_KEY` — faltam as credenciais na Vercel; repita o passo 12.1.
- `Falha ao gerar link de afiliado da Shopee: SHOPEE_API_ERROR (...)` — o corpo do erro retornado pela Shopee aparece entre parênteses. Causas prováveis: assinatura incorreta (revise `calculateShopeeSignature` e o formato exato do header — a documentação pública pode ter mudado), domínio da API errado (repita o passo 12.2), ou timestamp fora da janela de validade (o request demorou demais entre calcular a assinatura e a Shopee recebê-la — improvável, mas possível sob rede lenta).
- `Produto não encontrado na página do Mercado Livre: PRODUCT_NOT_FOUND (...)` **para um link da Shopee** — apesar da mensagem mencionar "Mercado Livre" (herdada do código original, ainda não generalizada), esse erro também dispara pra produtos Shopee cujas meta tags não bateram com os seletores usados (`og:image`, `meta[itemprop="price"]`) — o formato exato da página da Shopee ainda não foi confirmado contra o site real; pode precisar ajustar os seletores em `generate-link.playwright.mjs`.
- Link não é reconhecido como Shopee (`MARKETPLACE_NOT_SUPPORTED`) mesmo sendo um link Shopee válido — confira se o hostname resolvido bate com `shopee.com.br` (subdomínios inclusive); domínios regionais diferentes (ex: `.co.id` de outros países) não são reconhecidos por design.
```

- [ ] **Step 7: Commit**

```bash
git add src/lib/mercadolivre/affiliateLink.ts src/lib/mercadolivre/affiliateLink.test.ts .env.example docs/runbook.md
git commit -m "feat: integrar geracao de link da Shopee no orquestrador, documentar variaveis e runbook"
```
