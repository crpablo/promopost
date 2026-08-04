# Magalu Marketplace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Adicionar o Magalu (Magazine Luiza) como quarto marketplace suportado pelo PromoPost, ao lado de Mercado Livre, Shopee e Amazon.

**Architecture:** O script Playwright já existente (`generate-link.playwright.mjs`) ganha um quarto branch de detecção/geração de link, sem sessão logada nem chamada de API — só reescreve a query string da URL resolvida do produto com os identificadores de afiliado do usuário, mesmo princípio já usado pra Amazon. O resto do pipeline (extração de produto, publicação no Shopify, posts nas redes sociais) já é agnóstico de marketplace e não muda.

**Tech Stack:** Playwright (script `.mjs`), TypeScript, Vitest.

## Global Constraints

- Domínio do produto: `magazineluiza.com.br` (host regex: `/(^|\.)magazineluiza\.com\.br$/i`).
- Formato do link de afiliado: mesma URL resolvida do produto, com os parâmetros `partner_id`, `promoter_id`, `utm_source=divulgador`, `utm_medium=magalu`, `utm_campaign=<promoter_id>` sobrescritos pelos valores do usuário (nunca os de quem postou originalmente no canal).
- Novas variáveis de ambiente: `MAGALU_PARTNER_ID`, `MAGALU_PROMOTER_ID`.
- Novo código de erro: `MAGALU_CREDENTIALS_MISSING`, reportado antes de gastar tempo com scraping (mesmo padrão de `SHOPEE_CREDENTIALS_MISSING`/`AMAZON_CREDENTIALS_MISSING`).
- Extração de título/preço/imagem reaproveita o fallback genérico já existente (`h1`, `og:title`, `og:image`, `meta[itemprop=price]`) — sem seletor específico do Magalu, a menos que a validação ao vivo (fora deste plano) mostre necessidade.
- Fora de escopo: cupom de loja/categoria via `magazinevoce.com.br` (extensão futura, não implementada aqui).
- Domínio de CDN de imagem do Magalu a permitir nos proxies: `mlcdn.com.br` (regex: `/(^|\.)mlcdn\.com\.br$/i`) — cobre `a-static.mlcdn.com.br`, confirmável só na primeira extração real.

---

### Task 1: Magalu Affiliate Link Builder (função pura)

**Files:**
- Modify: `src/lib/mercadolivre/generate-link.playwright.mjs`
- Test: `src/lib/mercadolivre/generate-link.playwright.test.ts`

**Interfaces:**
- Produces (usado pela Task 2): `export function buildMagaluAffiliateLink(url, partnerId, promoterId)` — recebe a URL resolvida do produto e os dois identificadores, devolve a mesma URL com `partner_id`, `promoter_id`, `utm_source`, `utm_medium`, `utm_campaign` sobrescritos (ou adicionados, se ainda não existirem). Sem rede, sem estado — mesmo princípio de `buildAmazonAffiliateLink`, já existente no mesmo arquivo.

- [ ] **Step 1: Write the failing tests**

Adicione ao final de `src/lib/mercadolivre/generate-link.playwright.test.ts` (mantendo os testes já existentes intactos):

```javascript
// src/lib/mercadolivre/generate-link.playwright.test.ts (adicionar ao final do arquivo)
// @ts-expect-error TS7016 — módulo .mjs sem declaração de tipos (allowJs: false no tsconfig)
import { buildMagaluAffiliateLink } from './generate-link.playwright.mjs';

describe('buildMagaluAffiliateLink', () => {
  it('adiciona todos os parâmetros de afiliado numa URL sem nenhum deles', () => {
    const result = buildMagaluAffiliateLink(
      'https://www.magazineluiza.com.br/produto-x/p/abc123/',
      '3440',
      '5784620',
    );
    expect(result).toBe(
      'https://www.magazineluiza.com.br/produto-x/p/abc123/?partner_id=3440&promoter_id=5784620&utm_source=divulgador&utm_medium=magalu&utm_campaign=5784620',
    );
  });

  it('sobrescreve os parâmetros de afiliado de outro divulgador em vez de manter os dele', () => {
    const result = buildMagaluAffiliateLink(
      'https://www.magazineluiza.com.br/produto-x/p/abc123/?partner_id=9999&promoter_id=1111111&utm_source=divulgador&utm_medium=magalu&utm_campaign=1111111',
      '3440',
      '5784620',
    );
    expect(result).toBe(
      'https://www.magazineluiza.com.br/produto-x/p/abc123/?partner_id=3440&promoter_id=5784620&utm_source=divulgador&utm_medium=magalu&utm_campaign=5784620',
    );
  });

  it('preserva outros parâmetros existentes na URL que não sejam de afiliado', () => {
    const result = buildMagaluAffiliateLink(
      'https://www.magazineluiza.com.br/produto-x/p/abc123/?seller_id=lojasantfl',
      '3440',
      '5784620',
    );
    expect(result).toBe(
      'https://www.magazineluiza.com.br/produto-x/p/abc123/?seller_id=lojasantfl&partner_id=3440&promoter_id=5784620&utm_source=divulgador&utm_medium=magalu&utm_campaign=5784620',
    );
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/mercadolivre/generate-link.playwright.test.ts`
Expected: FAIL — `buildMagaluAffiliateLink` ainda não existe no módulo `.mjs` (erro de import).

- [ ] **Step 3: Write the implementation**

Em `src/lib/mercadolivre/generate-link.playwright.mjs`, adicione a função nova logo depois de `buildAmazonAffiliateLink` (antes de `generateMlAffiliateLink`):

```javascript
// src/lib/mercadolivre/generate-link.playwright.mjs (adicionar depois de buildAmazonAffiliateLink)
// Gera o link de afiliado do Magalu sem nenhuma chamada de rede — sobrescreve
// (ou adiciona, se ainda não existirem) os parâmetros partner_id, promoter_id
// e utm_source/utm_medium/utm_campaign na própria URL resolvida do produto.
// O link que já circula no canal de origem tem esse mesmo formato, só que
// com os valores do afiliado que postou — aqui trocamos pelos nossos, pra
// garantir que o crédito da venda vá pra nossa conta, nunca a de quem
// postou originalmente (confirmado com o usuário, 2026-08-04).
export function buildMagaluAffiliateLink(url, partnerId, promoterId) {
  const parsed = new URL(url);
  parsed.searchParams.set('partner_id', partnerId);
  parsed.searchParams.set('promoter_id', promoterId);
  parsed.searchParams.set('utm_source', 'divulgador');
  parsed.searchParams.set('utm_medium', 'magalu');
  parsed.searchParams.set('utm_campaign', promoterId);
  return parsed.toString();
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/mercadolivre/generate-link.playwright.test.ts`
Expected: PASS (todos os testes, incluindo os 3 novos).

- [ ] **Step 5: Run the full test suite**

Run: `npx vitest run`
Expected: todos os testes passando.

- [ ] **Step 6: Commit**

```bash
git add src/lib/mercadolivre/generate-link.playwright.mjs src/lib/mercadolivre/generate-link.playwright.test.ts
git commit -m "feat: funcao pura de link de afiliado do Magalu"
```

---

### Task 2: Detecção, credenciais e wiring no script + mapeamento em affiliateLink.ts

**Files:**
- Modify: `src/lib/mercadolivre/generate-link.playwright.mjs`
- Modify: `src/lib/mercadolivre/affiliateLink.ts`
- Modify: `src/lib/mercadolivre/affiliateLink.test.ts`
- Modify: `src/lib/marketplace/types.ts`

**Interfaces:**
- Consumes (da Task 1): `buildMagaluAffiliateLink(url, partnerId, promoterId)`.
- Produces (usado pela Task 3): `Product['marketplace']` inclui `'magalu'`. O script emite `{title, price, imageUrl, marketplace: 'magalu', affiliateLink}` em sucesso, ou `MAGALU_CREDENTIALS_MISSING` no stderr se `MAGALU_PARTNER_ID`/`MAGALU_PROMOTER_ID` faltarem. `fetchProductAndAffiliateLink` mapeia esse stderr pra um `Error` com mensagem `'Variáveis de ambiente do Magalu ausentes: MAGALU_PARTNER_ID, MAGALU_PROMOTER_ID'`.

- [ ] **Step 1: Write the failing tests**

Adicione ao final do `describe('fetchProductAndAffiliateLink', ...)` em `src/lib/mercadolivre/affiliateLink.test.ts` (mantendo os testes já existentes intactos):

```typescript
// src/lib/mercadolivre/affiliateLink.test.ts (adicionar ao final do describe já existente)
  it('retorna produto do Magalu com marketplace correto quando o script termina com sucesso', async () => {
    mockExecFileSuccess(
      `${JSON.stringify({
        title: 'Carregador Portátil Turbo Power Bank',
        price: 89.9,
        imageUrl: 'https://a-static.mlcdn.com.br/img.jpg',
        marketplace: 'magalu',
        affiliateLink: 'https://www.magazineluiza.com.br/produto-x/p/abc123/?partner_id=3440&promoter_id=5784620',
      })}\n`,
    );

    const result = await fetchProductAndAffiliateLink('https://www.magazineluiza.com.br/produto-x/p/abc123/');

    expect(result.product.marketplace).toBe('magalu');
  });

  it('lança erro quando o script reporta MAGALU_CREDENTIALS_MISSING no stderr', async () => {
    mockExecFileFailure('MAGALU_CREDENTIALS_MISSING');

    await expect(
      fetchProductAndAffiliateLink('https://www.magazineluiza.com.br/produto-x/p/abc123/'),
    ).rejects.toThrow('Variáveis de ambiente do Magalu ausentes');
  });

  it('passa MAGALU_PARTNER_ID e MAGALU_PROMOTER_ID como env vars pro processo filho', async () => {
    vi.stubEnv('MAGALU_PARTNER_ID', '3440');
    vi.stubEnv('MAGALU_PROMOTER_ID', '5784620');
    mockExecFileSuccess(
      `${JSON.stringify({
        title: 'Produto',
        price: 10,
        imageUrl: 'https://a-static.mlcdn.com.br/img.jpg',
        marketplace: 'magalu',
        affiliateLink: 'https://www.magazineluiza.com.br/produto-x/p/abc123/?partner_id=3440&promoter_id=5784620',
      })}\n`,
    );

    await fetchProductAndAffiliateLink('https://www.magazineluiza.com.br/produto-x/p/abc123/');

    expect(execFileMock).toHaveBeenCalledWith(
      'node',
      expect.any(Array),
      expect.objectContaining({
        env: expect.objectContaining({ MAGALU_PARTNER_ID: '3440', MAGALU_PROMOTER_ID: '5784620' }),
      }),
      expect.any(Function),
    );
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/mercadolivre/affiliateLink.test.ts`
Expected: FAIL — `affiliateLink.ts` ainda não reconhece `marketplace: 'magalu'` nem `MAGALU_CREDENTIALS_MISSING`, e `Product['marketplace']` ainda não aceita `'magalu'` (erro de tipo no teste, mas o teste em si roda via esbuild/Vitest sem checagem de tipo, então falha por `result.product.marketplace` vir `'mercadolivre'` — o valor default do mapeamento atual — em vez de `'magalu'`).

- [ ] **Step 3: Update the Product type**

Em `src/lib/marketplace/types.ts`, troque a linha do campo `marketplace`:

```typescript
// src/lib/marketplace/types.ts
export interface Product {
  title: string;
  price: number;
  imageUrl: string;
  marketplace?: 'mercadolivre' | 'shopee' | 'amazon' | 'magalu';
}
```

- [ ] **Step 4: Add Magalu detection, credentials check and wiring in the Playwright script**

Em `src/lib/mercadolivre/generate-link.playwright.mjs`, logo depois da linha `const isAmazon = /(^|\.)amazon\.com\.br$/i.test(resolvedHost);`, adicione a detecção do Magalu:

```javascript
// src/lib/mercadolivre/generate-link.playwright.mjs (logo depois da linha de isAmazon)
    const isMagalu = /(^|\.)magazineluiza\.com\.br$/i.test(resolvedHost);
```

Logo depois do bloco que checa a credencial da Amazon (`if (isAmazon) { amazonTag = ...; if (!amazonTag) {...} }`), adicione a checagem do Magalu:

```javascript
// src/lib/mercadolivre/generate-link.playwright.mjs (logo depois do bloco de checagem da Amazon)
    let magaluPartnerId;
    let magaluPromoterId;
    if (isMagalu) {
      magaluPartnerId = process.env.MAGALU_PARTNER_ID;
      magaluPromoterId = process.env.MAGALU_PROMOTER_ID;
      if (!magaluPartnerId || !magaluPromoterId) {
        console.error('MAGALU_CREDENTIALS_MISSING');
        process.exit(1);
      }
    }
```

Troque a linha `if (!isMercadoLivre && !isShopee && !isAmazon) {` pra incluir o Magalu:

```javascript
// src/lib/mercadolivre/generate-link.playwright.mjs
    if (!isMercadoLivre && !isShopee && !isAmazon && !isMagalu) {
      console.error(`MARKETPLACE_NOT_SUPPORTED (resolvido para: ${resolvedUrl})`);
      process.exit(1);
    }
```

Logo depois do bloco `if (isAmazon) { ... return; }` (o que gera e imprime o link de afiliado da Amazon), adicione o branch do Magalu, antes do fallback final do Mercado Livre:

```javascript
// src/lib/mercadolivre/generate-link.playwright.mjs (logo depois do bloco `if (isAmazon) { ... return; }`)
    if (isMagalu) {
      // 2 (Magalu). Sem API, sem sessão — só sobrescreve os parâmetros de
      // afiliado na própria URL resolvida do produto.
      const affiliateLink = buildMagaluAffiliateLink(resolvedUrl, magaluPartnerId, magaluPromoterId);
      console.log(JSON.stringify({ title, price, imageUrl, marketplace: 'magalu', affiliateLink }));
      return;
    }
```

- [ ] **Step 5: Update affiliateLink.ts**

Em `src/lib/mercadolivre/affiliateLink.ts`, dentro de `runScript`'s caller (`fetchProductAndAffiliateLink`), troque o objeto de env passado pro processo filho pra incluir as duas variáveis novas:

```typescript
// src/lib/mercadolivre/affiliateLink.ts (troca o objeto de env dentro de runScript(...))
    const result = await runScript(productLink, {
      ...process.env,
      ML_SESSION_PATH: sessionPath,
      SHOPEE_APP_ID: process.env.SHOPEE_APP_ID ?? '',
      SHOPEE_SECRET_KEY: process.env.SHOPEE_SECRET_KEY ?? '',
      AMAZON_ASSOCIATE_TAG: process.env.AMAZON_ASSOCIATE_TAG ?? '',
      MAGALU_PARTNER_ID: process.env.MAGALU_PARTNER_ID ?? '',
      MAGALU_PROMOTER_ID: process.env.MAGALU_PROMOTER_ID ?? '',
    });
```

Adicione o mapeamento de `MAGALU_CREDENTIALS_MISSING`, logo depois do bloco que já mapeia `AMAZON_CREDENTIALS_MISSING`:

```typescript
// src/lib/mercadolivre/affiliateLink.ts (logo depois do bloco que mapeia AMAZON_CREDENTIALS_MISSING)
    if (stderr.includes('MAGALU_CREDENTIALS_MISSING')) {
      throw new Error('Variáveis de ambiente do Magalu ausentes: MAGALU_PARTNER_ID, MAGALU_PROMOTER_ID');
    }
```

Troque a expressão que mapeia `parsed.marketplace` pra incluir o Magalu:

```typescript
// src/lib/mercadolivre/affiliateLink.ts (troca a expressão de marketplace, logo antes do `return`)
  const marketplace =
    parsed.marketplace === 'shopee'
      ? 'shopee'
      : parsed.marketplace === 'amazon'
        ? 'amazon'
        : parsed.marketplace === 'magalu'
          ? 'magalu'
          : 'mercadolivre';
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run src/lib/mercadolivre/affiliateLink.test.ts`
Expected: PASS (todos os testes, incluindo os 3 novos).

- [ ] **Step 7: Run the full test suite and typecheck**

Run: `npx vitest run`
Expected: todos os testes passando.

Run: `npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 8: Commit**

```bash
git add src/lib/mercadolivre/generate-link.playwright.mjs src/lib/mercadolivre/affiliateLink.ts src/lib/mercadolivre/affiliateLink.test.ts src/lib/marketplace/types.ts
git commit -m "feat: deteccao e geracao de link de afiliado do Magalu no pipeline"
```

---

### Task 3: Legenda social e extrator de promoção do Telegram

**Files:**
- Modify: `src/lib/social/caption.ts`
- Modify: `src/lib/social/caption.test.ts`
- Modify: `src/lib/telegram/extractPromo.ts`
- Modify: `src/lib/telegram/extractPromo.test.ts`

**Interfaces:**
- Consumes (da Task 2): `Product['marketplace']` inclui `'magalu'`.

- [ ] **Step 1: Write the failing test for the caption**

Adicione ao final de `src/lib/social/caption.test.ts` (mantendo os testes já existentes intactos, próximo ao teste equivalente da Amazon):

```typescript
// src/lib/social/caption.test.ts (adicionar próximo ao teste equivalente da Amazon)
  it('usa #magalu na legenda quando o produto vem do Magalu', () => {
    const result = buildSocialCaption(
      { title: 'Produto Z', price: 89.9, imageUrl: 'https://x.com/img.jpg', marketplace: 'magalu' },
      'https://www.magazineluiza.com.br/produto-x/p/abc123/?partner_id=3440&promoter_id=5784620',
    );

    expect(result).toBe(
      'Produto Z\n\n🏷️ R$89,90\n\n🔗 Confira: https://www.magazineluiza.com.br/produto-x/p/abc123/?partner_id=3440&promoter_id=5784620 (também no link da bio)\n\n#promocao #oferta #magalu #desconto',
    );
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/social/caption.test.ts`
Expected: FAIL — `buildHashtags` ainda não reconhece `'magalu'`, então cai no default `#mercadolivre`.

- [ ] **Step 3: Update the hashtag map**

Em `src/lib/social/caption.ts`, troque a linha do mapa de hashtags:

```typescript
// src/lib/social/caption.ts
function buildHashtags(marketplace: Product['marketplace']): string {
  const marketplaceTags: Record<string, string> = { shopee: '#shopee', amazon: '#amazon', magalu: '#magalu' };
  const marketplaceTag = marketplaceTags[marketplace ?? ''] ?? '#mercadolivre';
  return `#promocao #oferta ${marketplaceTag} #desconto`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/social/caption.test.ts`
Expected: PASS (todos os testes, incluindo o novo).

- [ ] **Step 5: Write the failing test for the promo extractor**

Adicione ao final do `describe('extractPromo', ...)` em `src/lib/telegram/extractPromo.test.ts`, próximo ao teste equivalente da Amazon:

```typescript
// src/lib/telegram/extractPromo.test.ts (adicionar próximo ao teste equivalente da Amazon)
  it('extrai link e preço com desconto de uma promo do Magalu', async () => {
    generateObjectMock.mockResolvedValue({
      object: {
        isPromo: true,
        link: 'https://www.magazineluiza.com.br/carregador-portatil-turbo-power-bank/p/dkba5b776g/te/accp/',
        coupon: null,
        discountedPrice: 89.9,
      },
    });

    const result = await extractPromo(
      'Carregador Portátil Turbo Power Bank\nDe R$129,90 por R$89,90\nhttps://www.magazineluiza.com.br/carregador-portatil-turbo-power-bank/p/dkba5b776g/te/accp/',
    );

    expect(result).toEqual({
      isPromo: true,
      link: 'https://www.magazineluiza.com.br/carregador-portatil-turbo-power-bank/p/dkba5b776g/te/accp/',
      coupon: null,
      discountedPrice: 89.9,
    });
    expect(generateObjectMock).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: expect.stringContaining('Carregador Portátil Turbo Power Bank'),
      }),
    );
  });
```

- [ ] **Step 6: Run test to verify it fails**

Run: `npx vitest run src/lib/telegram/extractPromo.test.ts`
Expected: PASS de qualquer forma — esse teste mocka `generateObject` diretamente, então passa mesmo antes da mudança de prompt (o teste valida que `extractPromo` repassa o resultado mockado corretamente, não o conteúdo do prompt em si). Ainda assim, siga o Step 7 pra manter o prompt coerente com os outros três marketplaces já listados nele.

- [ ] **Step 7: Update the LLM prompt**

Em `src/lib/telegram/extractPromo.ts`, troque as três frases de `PROMPT_INSTRUCTIONS` que hoje listam só Mercado Livre/Shopee/Amazon:

```typescript
// src/lib/telegram/extractPromo.ts (troca a string PROMPT_INSTRUCTIONS inteira)
const PROMPT_INSTRUCTIONS = `Você recebe o texto de uma mensagem de um grupo de promoções de compras online.

Decida se a mensagem é uma promoção de um produto do Mercado Livre (mercadolivre.com.br ou mercadolibre.com), da Shopee (shopee.com.br), da Amazon (amazon.com.br) ou do Magalu (magazineluiza.com.br), incluindo links de encurtador/rastreador que podem levar pra lá — nesse caso ainda assim considere como possível promo válida e devolva o link como veio na mensagem. Isso inclui cupons de loja ou categoria inteira do Mercado Livre (sem produto único vinculado, com um link pra página de listas do afiliado, ex: mercadolivre.com.br/social/{handle}/lists) — também são promoções válidas.

Se for uma promoção do Mercado Livre, da Shopee, da Amazon ou do Magalu, extraia:
- link: a URL do produto (ou do encurtador, ou da página de listas do afiliado no caso de cupom de loja/categoria inteira) exatamente como aparece na mensagem.
- coupon: o código do cupom de desconto, se a mensagem mencionar um. Caso contrário, null. Independente de haver preço com desconto ou não.
- discountedPrice: o preço final de venda mencionado na mensagem (o valor "por", não o valor "de"), como número (ex: 89.90) — sempre que a mensagem deixar claro esse valor, com ou sem cupom (pode ser um desconto direto, sem código nenhum). Se a mensagem não deixar claro um preço final específico, use null.
- discountPercent: o percentual de desconto do cupom (ex: "20% OFF" → 20), como número, quando a mensagem mencionar um desconto percentual. Se não houver percentual mencionado, use null.
- minPurchaseValue: o valor mínimo de compra pra o cupom valer (ex: "compras acima de R$59,00" → 59), como número. Se não houver valor mínimo mencionado, use null.
- maxDiscountValue: o valor máximo de desconto que o cupom concede (ex: "desconto máximo de R$30" → 30), como número. Se não houver valor máximo mencionado, use null.

Se a mensagem não for sobre uma promoção do Mercado Livre, da Shopee, da Amazon nem do Magalu (ex: é conversa comum, ou é promoção de outro site/marketplace), retorne isPromo: false e os demais campos null.`;
```

- [ ] **Step 8: Run the full test suite and typecheck**

Run: `npx vitest run`
Expected: todos os testes passando.

Run: `npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 9: Commit**

```bash
git add src/lib/social/caption.ts src/lib/social/caption.test.ts src/lib/telegram/extractPromo.ts src/lib/telegram/extractPromo.test.ts
git commit -m "feat: legenda social e extrator de promocao reconhecem o Magalu"
```

---

### Task 4: Allowlist de imagem e variáveis de ambiente

**Files:**
- Modify: `src/app/api/story-image/route.tsx`
- Modify: `src/app/api/story-image/route.test.ts`
- Modify: `src/app/api/tiktok-image-proxy/route.ts`
- Modify: `src/app/api/tiktok-image-proxy/route.test.ts`
- Modify: `.env.example`

**Interfaces:**
- Nenhuma nova — esse task só estende allowlists e documentação já existentes, sem depender de nada das tasks anteriores além do domínio de imagem já definido nos Global Constraints.

- [ ] **Step 1: Write the failing test for story-image**

Adicione ao `describe('GET /api/story-image', ...)` em `src/app/api/story-image/route.test.ts`, logo depois do teste equivalente da Amazon:

```typescript
// src/app/api/story-image/route.test.ts (adicionar logo depois do teste equivalente da Amazon)
  it('aceita imageUrl de host mlcdn.com.br (Magalu) sem cair no erro de host não permitido', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404 }));

    const request = new Request(
      'https://promopost.example.com/api/story-image?imageUrl=' +
        encodeURIComponent('https://a-static.mlcdn.com.br/img.jpg') +
        '&title=Produto&price=99.9',
    );
    const response = await GET(request);
    const json = await response.json();

    expect(response.status).not.toBe(400);
    expect(json?.erro).not.toBe('Host da imagem não permitido');
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/api/story-image/route.test.ts`
Expected: FAIL — `mlcdn.com.br` ainda não está na allowlist, resposta vem 400 com `'Host da imagem não permitido'`.

- [ ] **Step 3: Update the allowlist in story-image**

Em `src/app/api/story-image/route.tsx`, troque o array `ALLOWED_IMAGE_HOSTS`:

```typescript
// src/app/api/story-image/route.tsx
const ALLOWED_IMAGE_HOSTS = [
  /(^|\.)mlstatic\.com$/i,
  /(^|\.)susercontent\.com$/i,
  /(^|\.)media-amazon\.com$/i,
  /(^|\.)ssl-images-amazon\.com$/i,
  /(^|\.)mlcdn\.com\.br$/i,
];
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/app/api/story-image/route.test.ts`
Expected: PASS (todos os testes, incluindo o novo).

- [ ] **Step 5: Write the failing test for tiktok-image-proxy**

Adicione ao `describe('GET /api/tiktok-image-proxy', ...)` em `src/app/api/tiktok-image-proxy/route.test.ts`, logo depois do teste equivalente da Amazon:

```typescript
// src/app/api/tiktok-image-proxy/route.test.ts (adicionar logo depois do teste equivalente da Amazon)
  it('busca e normaliza imagem de host mlcdn.com.br (Magalu) sem cair no erro de host não permitido', async () => {
    const imageBytes = new Uint8Array([1, 2, 3, 4]);
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        headers: new Headers({ 'content-type': 'image/webp' }),
        arrayBuffer: async () => imageBytes.buffer,
      }),
    );
    toBufferMock.mockResolvedValue(Buffer.from(JPEG_OUTPUT_BYTES));

    const request = new Request(
      'https://promopost.example.com/api/tiktok-image-proxy?imageUrl=' +
        encodeURIComponent('https://a-static.mlcdn.com.br/img.jpg'),
    );
    const response = await GET(request);
    const body = new Uint8Array(await response.arrayBuffer());

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('image/jpeg');
    expect(body).toEqual(JPEG_OUTPUT_BYTES);
  });
```

- [ ] **Step 6: Run test to verify it fails**

Run: `npx vitest run src/app/api/tiktok-image-proxy/route.test.ts`
Expected: FAIL — `mlcdn.com.br` ainda não está na allowlist, resposta vem 400.

- [ ] **Step 7: Update the allowlist in tiktok-image-proxy**

Em `src/app/api/tiktok-image-proxy/route.ts`, troque o array `ALLOWED_IMAGE_HOSTS`:

```typescript
// src/app/api/tiktok-image-proxy/route.ts
const ALLOWED_IMAGE_HOSTS = [
  /(^|\.)mlstatic\.com$/i,
  /(^|\.)susercontent\.com$/i,
  /(^|\.)media-amazon\.com$/i,
  /(^|\.)mlcdn\.com\.br$/i,
];
```

- [ ] **Step 8: Run test to verify it passes**

Run: `npx vitest run src/app/api/tiktok-image-proxy/route.test.ts`
Expected: PASS (todos os testes, incluindo o novo).

- [ ] **Step 9: Document the new env vars**

Em `.env.example`, adicione ao final do arquivo (logo depois do bloco de `AMAZON_ASSOCIATE_TAG`):

```
# Partner ID e Promoter ID do programa de afiliados do Magalu ("Parceiro
# Magalu") — identificadores públicos da conta, extraídos de um link de
# produto gerado pela própria conta, não são segredo, mas continuam
# configuráveis via variável de ambiente em vez de hardcoded.
MAGALU_PARTNER_ID=
MAGALU_PROMOTER_ID=
```

- [ ] **Step 10: Run the full test suite and typecheck**

Run: `npx vitest run`
Expected: todos os testes passando.

Run: `npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 11: Commit**

```bash
git add src/app/api/story-image/route.tsx src/app/api/story-image/route.test.ts src/app/api/tiktok-image-proxy/route.ts src/app/api/tiktok-image-proxy/route.test.ts .env.example
git commit -m "feat: allowlist de imagem do Magalu nos proxies de Story/TikTok"
```
