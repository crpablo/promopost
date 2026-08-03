# Amazon como terceiro marketplace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Adicionar a Amazon como terceiro marketplace suportado pelo PromoPost, ao lado de Mercado Livre e Shopee — detecção automática, extração de produto via scraping, e geração de link de afiliado sem API (só o parâmetro `tag`).

**Architecture:** O mesmo script Playwright que já resolve o redirect e roteia entre Mercado Livre e Shopee (`generate-link.playwright.mjs`) ganha um terceiro branch pra `amazon.com.br`. Duas funções puras novas (`parseBrazilianPrice`, `buildAmazonAffiliateLink`) ficam no mesmo arquivo, testáveis isoladamente sem precisar de browser real — mesmo padrão já usado pra `calculateShopeeSignature`. `affiliateLink.ts` passa a repassar `AMAZON_ASSOCIATE_TAG` como env var pro processo filho e a reconhecer `'amazon'` como marketplace válido no JSON de saída.

**Tech Stack:** Node.js, Playwright, TypeScript, Vitest — nenhuma dependência nova.

## Global Constraints

- Detecção do marketplace: hostname resolvido `amazon.com.br` (regex `/(^|\.)amazon\.com\.br$/i`).
- Sem Product Advertising API — extração de dados 100% via scraping da página.
- Preço: seletor primário `.a-price .a-offscreen` (texto formatado tipo `"R$ 1.234,56"`, precisa de parse pra número), fallback pras mesmas meta tags já usadas nos outros marketplaces (`meta[itemprop="price"]`, `meta[property="product:price:amount"]`).
- Título: `h1` primeiro, fallback `meta[property="og:title"]` (mesmo fallback já usado pra Shopee).
- Link de afiliado: URL resolvida do produto + parâmetro de query `tag=<AMAZON_ASSOCIATE_TAG>` (adiciona ou sobrescreve se já existir um `tag` diferente) — sem chamada de rede, sem assinatura.
- `AMAZON_ASSOCIATE_TAG` ausente → erro `AMAZON_CREDENTIALS_MISSING`, checado assim que o marketplace é identificado como Amazon, antes de gastar tempo com scraping (mesmo padrão de `SHOPEE_CREDENTIALS_MISSING`).
- `Product.marketplace` (`src/lib/marketplace/types.ts`) ganha `'amazon'` como terceiro valor possível.

---

### Task 1: Funções puras — parse de preço e montagem do link de afiliado da Amazon

**Files:**
- Modify: `src/lib/mercadolivre/generate-link.playwright.mjs`
- Modify: `src/lib/mercadolivre/generate-link.playwright.test.ts`
- Modify: `src/lib/marketplace/types.ts`

**Interfaces:**
- Produces (usado pela Task 3, dentro do mesmo arquivo): `export function parseBrazilianPrice(text: string | null): number` — converte texto formatado tipo `"R$ 1.234,56"` pra `1234.56`; retorna `NaN` se `text` for `null`/vazio/não numérico.
- Produces (usado pela Task 3, dentro do mesmo arquivo): `export function buildAmazonAffiliateLink(url: string, tag: string): string` — adiciona/sobrescreve o parâmetro `tag` na URL recebida, devolve a URL completa como string.
- Produces (usado pela Task 4): `Product['marketplace']` passa a aceitar `'amazon'`.

- [ ] **Step 1: Write the failing tests**

Adicione ao final de `src/lib/mercadolivre/generate-link.playwright.test.ts` (mantendo o `describe('calculateShopeeSignature', ...)` já existente intacto):

```typescript
// src/lib/mercadolivre/generate-link.playwright.test.ts (adicionar ao final do arquivo)
// @ts-expect-error TS7016 — módulo .mjs sem declaração de tipos (allowJs: false no tsconfig)
import { buildAmazonAffiliateLink, parseBrazilianPrice } from './generate-link.playwright.mjs';

describe('parseBrazilianPrice', () => {
  it('converte texto formatado em reais pra número', () => {
    expect(parseBrazilianPrice('R$ 1.234,56')).toBe(1234.56);
  });

  it('converte preço sem separador de milhar', () => {
    expect(parseBrazilianPrice('R$ 99,90')).toBe(99.9);
  });

  it('lida com espaço não-quebrável entre "R$" e o valor', () => {
    expect(parseBrazilianPrice('R$ 149,00')).toBe(149);
  });

  it('retorna NaN quando o texto é null', () => {
    expect(parseBrazilianPrice(null)).toBeNaN();
  });

  it('retorna NaN quando o texto não tem número nenhum', () => {
    expect(parseBrazilianPrice('indisponível')).toBeNaN();
  });
});

describe('buildAmazonAffiliateLink', () => {
  it('adiciona o parâmetro tag numa URL sem query string', () => {
    const result = buildAmazonAffiliateLink('https://www.amazon.com.br/dp/B08XYZ', 'crpablo0d-20');
    expect(result).toBe('https://www.amazon.com.br/dp/B08XYZ?tag=crpablo0d-20');
  });

  it('adiciona o parâmetro tag preservando outros parâmetros existentes', () => {
    const result = buildAmazonAffiliateLink('https://www.amazon.com.br/dp/B08XYZ?ref=abc', 'crpablo0d-20');
    expect(result).toBe('https://www.amazon.com.br/dp/B08XYZ?ref=abc&tag=crpablo0d-20');
  });

  it('sobrescreve um parâmetro tag já existente em vez de duplicar', () => {
    const result = buildAmazonAffiliateLink('https://www.amazon.com.br/dp/B08XYZ?tag=outro-20', 'crpablo0d-20');
    expect(result).toBe('https://www.amazon.com.br/dp/B08XYZ?tag=crpablo0d-20');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/mercadolivre/generate-link.playwright.test.ts`
Expected: FAIL com `SyntaxError` ou `undefined is not a function` — `parseBrazilianPrice` e `buildAmazonAffiliateLink` ainda não existem no `.mjs`.

- [ ] **Step 3: Write the implementation**

Em `src/lib/mercadolivre/generate-link.playwright.mjs`, logo depois da função `calculateShopeeSignature` já existente (antes de `async function main()`), adicione:

```javascript
// Converte o texto formatado do preço da Amazon (ex: "R$ 1.234,56", com
// separador de milhar "." e decimal ",") pra número. Remove tudo que não
// for dígito/vírgula/ponto/sinal, remove pontos de milhar, troca vírgula
// decimal por ponto. Retorna NaN se não sobrar nada numérico (inclui o
// caso de `text` ser null).
export function parseBrazilianPrice(text) {
  if (!text) return NaN;
  const cleaned = text.replace(/[^\d,.-]/g, '').replace(/\./g, '').replace(',', '.');
  return Number.parseFloat(cleaned);
}

// Gera o link de afiliado da Amazon sem nenhuma chamada de rede — só
// adiciona (ou sobrescreve, se já existir) o parâmetro `tag` na própria
// URL resolvida do produto. Extraída como função pura pra ser testável
// isoladamente, mesmo padrão já usado pra calculateShopeeSignature.
export function buildAmazonAffiliateLink(url, tag) {
  const parsed = new URL(url);
  parsed.searchParams.set('tag', tag);
  return parsed.toString();
}
```

Em `src/lib/marketplace/types.ts`, troque:

```typescript
export interface Product {
  title: string;
  price: number;
  imageUrl: string;
  marketplace?: 'mercadolivre' | 'shopee';
}
```

por:

```typescript
export interface Product {
  title: string;
  price: number;
  imageUrl: string;
  marketplace?: 'mercadolivre' | 'shopee' | 'amazon';
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/mercadolivre/generate-link.playwright.test.ts`
Expected: PASS (todos os testes, incluindo os de `calculateShopeeSignature` que não mudaram)

- [ ] **Step 5: Run typecheck**

Run: `npm run typecheck`
Expected: sem erros — o `Product.marketplace` mais amplo não quebra nenhum consumidor existente (Mercado Livre e Shopee continuam sendo subconjuntos válidos do novo tipo).

- [ ] **Step 6: Commit**

```bash
git add src/lib/mercadolivre/generate-link.playwright.mjs src/lib/mercadolivre/generate-link.playwright.test.ts src/lib/marketplace/types.ts
git commit -m "feat: funcoes puras de parse de preco e link de afiliado da Amazon"
```

---

### Task 2: Hashtag `#amazon` na legenda social

**Files:**
- Modify: `src/lib/social/caption.ts`
- Modify: `src/lib/social/caption.test.ts`

**Interfaces:**
- Consumes: `Product['marketplace']` (Task 1) incluindo `'amazon'`.
- Produces: nenhuma interface nova — `buildSocialCaption` continua com a mesma assinatura, só o texto gerado muda pra produtos Amazon.

- [ ] **Step 1: Write the failing test**

Adicione ao final do `describe('buildSocialCaption', ...)` em `src/lib/social/caption.test.ts`:

```typescript
// src/lib/social/caption.test.ts (adicionar dentro do describe existente, ao final)
it('usa #amazon na legenda quando o produto vem da Amazon', () => {
  const text = buildSocialCaption(
    { title: 'Produto W', price: 129.9, imageUrl: 'https://x.com/img.jpg', marketplace: 'amazon' },
    'https://www.amazon.com.br/dp/B08XYZ?tag=crpablo0d-20',
  );
  expect(text).toBe(
    'Produto W\n\n🏷️ R$129,90\n\n🔗 Confira: https://www.amazon.com.br/dp/B08XYZ?tag=crpablo0d-20 (também no link da bio)\n\n#promocao #oferta #amazon #desconto',
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/social/caption.test.ts`
Expected: FAIL — a asserção espera `#amazon`, mas `buildHashtags` ainda cai no `#mercadolivre` default pra qualquer marketplace que não seja `'shopee'`.

- [ ] **Step 3: Write the implementation**

Em `src/lib/social/caption.ts`, troque a função `buildHashtags`:

```typescript
function buildHashtags(marketplace: Product['marketplace']): string {
  const marketplaceTag = marketplace === 'shopee' ? '#shopee' : '#mercadolivre';
  return `#promocao #oferta ${marketplaceTag} #desconto`;
}
```

por:

```typescript
function buildHashtags(marketplace: Product['marketplace']): string {
  const marketplaceTags: Record<string, string> = { shopee: '#shopee', amazon: '#amazon' };
  const marketplaceTag = marketplaceTags[marketplace ?? ''] ?? '#mercadolivre';
  return `#promocao #oferta ${marketplaceTag} #desconto`;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/social/caption.test.ts`
Expected: PASS (todos os testes, incluindo os de Mercado Livre/Shopee que não mudaram)

- [ ] **Step 5: Commit**

```bash
git add src/lib/social/caption.ts src/lib/social/caption.test.ts
git commit -m "feat: hashtag #amazon na legenda social pra produtos Amazon"
```

---

### Task 3: Branch da Amazon no script Playwright (detecção, scraping, link)

**Files:**
- Modify: `src/lib/mercadolivre/generate-link.playwright.mjs`

**Interfaces:**
- Consumes: `parseBrazilianPrice`, `buildAmazonAffiliateLink` (Task 1, mesmo arquivo).
- Produces: o script passa a emitir `{"title","price","imageUrl","marketplace":"amazon","affiliateLink"}` em stdout quando o link resolvido for da Amazon, ou `AMAZON_CREDENTIALS_MISSING` em stderr (exit 1) se `AMAZON_ASSOCIATE_TAG` não estiver setada — consumido pela Task 4.

- [ ] **Step 1: Adicionar detecção de hostname da Amazon**

Em `generate-link.playwright.mjs`, dentro de `main()`, troque:

```javascript
    const isMercadoLivre =
      /(^|\.)mercadolivre\.com\.br$/i.test(resolvedHost) || /(^|\.)mercadolibre\.com$/i.test(resolvedHost);
    const isShopee = /(^|\.)shopee\.com\.br$/i.test(resolvedHost);
```

por:

```javascript
    const isMercadoLivre =
      /(^|\.)mercadolivre\.com\.br$/i.test(resolvedHost) || /(^|\.)mercadolibre\.com$/i.test(resolvedHost);
    const isShopee = /(^|\.)shopee\.com\.br$/i.test(resolvedHost);
    const isAmazon = /(^|\.)amazon\.com\.br$/i.test(resolvedHost);
```

- [ ] **Step 2: Adicionar checagem de credenciais da Amazon e ampliar o erro de marketplace não suportado**

Troque:

```javascript
    let shopeeAppId;
    let shopeeSecretKey;
    if (isShopee) {
      shopeeAppId = process.env.SHOPEE_APP_ID;
      shopeeSecretKey = process.env.SHOPEE_SECRET_KEY;
      if (!shopeeAppId || !shopeeSecretKey) {
        console.error('SHOPEE_CREDENTIALS_MISSING');
        process.exit(1);
      }
    }

    if (!isMercadoLivre && !isShopee) {
      console.error(`MARKETPLACE_NOT_SUPPORTED (resolvido para: ${resolvedUrl})`);
      process.exit(1);
    }
```

por:

```javascript
    let shopeeAppId;
    let shopeeSecretKey;
    if (isShopee) {
      shopeeAppId = process.env.SHOPEE_APP_ID;
      shopeeSecretKey = process.env.SHOPEE_SECRET_KEY;
      if (!shopeeAppId || !shopeeSecretKey) {
        console.error('SHOPEE_CREDENTIALS_MISSING');
        process.exit(1);
      }
    }

    // Checa a credencial da Amazon assim que sabemos que é Amazon (o
    // Associate Tag não é secreto, mas sem ele o link gerado não dá
    // comissão nenhuma pro afiliado — falha explícita é melhor que gerar
    // um link "funcional" só que sem crédito).
    let amazonTag;
    if (isAmazon) {
      amazonTag = process.env.AMAZON_ASSOCIATE_TAG;
      if (!amazonTag) {
        console.error('AMAZON_CREDENTIALS_MISSING');
        process.exit(1);
      }
    }

    if (!isMercadoLivre && !isShopee && !isAmazon) {
      console.error(`MARKETPLACE_NOT_SUPPORTED (resolvido para: ${resolvedUrl})`);
      process.exit(1);
    }
```

- [ ] **Step 3: Estender o fallback de título e trocar a extração de preço**

Troque:

```javascript
    // 1. Dados do produto (já estamos na página, resolvida acima) — mesmo
    // padrão de meta tags pros dois marketplaces (Open Graph + itemprop).
    let title = await page.locator('h1').first().innerText({ timeout: 15000 }).catch(() => null);
    if (!title && isShopee) {
      // Páginas de produto da Shopee frequentemente não expõem o nome do
      // produto num <h1> — cai pro og:title, mesmo padrão de .getAttribute
      // já usado abaixo pra imageUrl/priceMeta. Restrito à Shopee pra não
      // mudar o comportamento do Mercado Livre (que já funciona com h1) —
      // uma página de erro/interstitial do ML sem h1 mas com og:title
      // continuaria corretamente caindo em PRODUCT_NOT_FOUND.
      title = await page
        .locator('meta[property="og:title"]')
        .first()
        .getAttribute('content')
        .catch(() => null);
    }

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
```

por:

```javascript
    // 1. Dados do produto (já estamos na página, resolvida acima) — mesmo
    // padrão de meta tags pros marketplaces, com seletor específico da
    // Amazon pro preço (ver parseBrazilianPrice, no topo do arquivo).
    let title = await page.locator('h1').first().innerText({ timeout: 15000 }).catch(() => null);
    if (!title && (isShopee || isAmazon)) {
      // Páginas de produto da Shopee e da Amazon frequentemente não expõem
      // o nome do produto de forma confiável só via h1 — cai pro og:title,
      // mesmo padrão de .getAttribute já usado abaixo pra imageUrl/preço.
      // Restrito a Shopee/Amazon pra não mudar o comportamento do Mercado
      // Livre (que já funciona com h1) — uma página de erro/interstitial
      // do ML sem h1 mas com og:title continuaria corretamente caindo em
      // PRODUCT_NOT_FOUND.
      title = await page
        .locator('meta[property="og:title"]')
        .first()
        .getAttribute('content')
        .catch(() => null);
    }

    let priceRaw = null;
    let price = NaN;
    if (isAmazon) {
      // A Amazon não expõe meta tag de preço confiável — o valor formatado
      // fica num elemento visual/acessível (".a-price .a-offscreen"), ex:
      // "R$ 1.234,56".
      priceRaw = await page
        .locator('.a-price .a-offscreen')
        .first()
        .innerText({ timeout: 10000 })
        .catch(() => null);
      price = parseBrazilianPrice(priceRaw);
    }
    if (Number.isNaN(price)) {
      // Fallback pras mesmas meta tags dos outros marketplaces — cobre
      // Mercado Livre/Shopee sempre, e a Amazon só se o seletor acima não
      // achar nada (layout diferente, produto sem preço visível, etc).
      priceRaw = await page
        .locator('meta[itemprop="price"], meta[property="product:price:amount"]')
        .first()
        .getAttribute('content')
        .catch(() => null);
      price = priceRaw ? Number.parseFloat(priceRaw) : NaN;
    }

    const imageUrl = await page
      .locator('meta[property="og:image"]')
      .first()
      .getAttribute('content')
      .catch(() => null);

    if (!title || Number.isNaN(price) || !imageUrl) {
      console.error(
        `PRODUCT_NOT_FOUND (title=${JSON.stringify(title)}, price=${priceRaw}, imageUrl=${JSON.stringify(imageUrl)})`,
      );
      process.exit(1);
    }
```

- [ ] **Step 4: Adicionar o branch de geração de link da Amazon**

Troque:

```javascript
    if (isShopee) {
```

(o `if` que abre o bloco da Shopee) — mantendo TODO o corpo desse bloco existente intacto — e logo **depois** do `return;` que fecha esse bloco da Shopee (antes do comentário `// 2 (Mercado Livre). Visita o gerador...`), adicione:

```javascript
    if (isAmazon) {
      // 2 (Amazon). Sem API, sem sessão — só garante o parâmetro de
      // afiliado na própria URL resolvida do produto.
      const affiliateLink = buildAmazonAffiliateLink(resolvedUrl, amazonTag);
      console.log(JSON.stringify({ title, price, imageUrl, marketplace: 'amazon', affiliateLink }));
      return;
    }

```

- [ ] **Step 5: Rodar a suíte inteira e o typecheck**

Run: `npm test && npm run typecheck`
Expected: PASS — nenhum teste existente de Mercado Livre/Shopee foi afetado (o script `.mjs` não tem teste automatizado além das funções puras já cobertas na Task 1).

- [ ] **Step 6: Commit**

```bash
git add src/lib/mercadolivre/generate-link.playwright.mjs
git commit -m "feat: branch da Amazon no script de geracao de link (deteccao, scraping, link)"
```

---

### Task 4: `affiliateLink.ts` — repassar credencial e reconhecer marketplace Amazon

**Files:**
- Modify: `src/lib/mercadolivre/affiliateLink.ts`
- Modify: `src/lib/mercadolivre/affiliateLink.test.ts`

**Interfaces:**
- Consumes: código de erro `AMAZON_CREDENTIALS_MISSING` emitido pelo script (Task 3); `marketplace: 'amazon'` no JSON de stdout do script (Task 3).
- Produces: `fetchProductAndAffiliateLink` continua com a mesma assinatura (`Promise<AffiliateResult>`), mas `AffiliateResult.product.marketplace` agora pode ser `'amazon'`.

- [ ] **Step 1: Write the failing tests**

Adicione ao final de `src/lib/mercadolivre/affiliateLink.test.ts`, dentro do `describe('fetchProductAndAffiliateLink', ...)` já existente:

```typescript
// src/lib/mercadolivre/affiliateLink.test.ts (adicionar dentro do describe existente, ao final)
it('retorna produto da Amazon com marketplace correto quando o script termina com sucesso', async () => {
  mockExecFileSuccess(
    `${JSON.stringify({
      title: 'Fone Bluetooth Amazon',
      price: 129.9,
      imageUrl: 'https://m.media-amazon.com/images/I/abc.jpg',
      marketplace: 'amazon',
      affiliateLink: 'https://www.amazon.com.br/dp/B08XYZ?tag=crpablo0d-20',
    })}\n`,
  );

  const result = await fetchProductAndAffiliateLink('https://www.amazon.com.br/dp/B08XYZ');

  expect(result.product.marketplace).toBe('amazon');
});

it('lança erro quando o script reporta AMAZON_CREDENTIALS_MISSING no stderr', async () => {
  mockExecFileFailure('AMAZON_CREDENTIALS_MISSING');

  await expect(
    fetchProductAndAffiliateLink('https://www.amazon.com.br/dp/B08XYZ'),
  ).rejects.toThrow('Variáveis de ambiente da Amazon ausentes');
});

it('passa AMAZON_ASSOCIATE_TAG como env var pro processo filho', async () => {
  vi.stubEnv('AMAZON_ASSOCIATE_TAG', 'crpablo0d-20');
  mockExecFileSuccess(
    `${JSON.stringify({
      title: 'Produto',
      price: 10,
      imageUrl: 'https://m.media-amazon.com/images/I/x.jpg',
      marketplace: 'amazon',
      affiliateLink: 'https://www.amazon.com.br/dp/X?tag=crpablo0d-20',
    })}\n`,
  );

  await fetchProductAndAffiliateLink('https://www.amazon.com.br/dp/X');

  expect(execFileMock).toHaveBeenCalledWith(
    'node',
    expect.any(Array),
    expect.objectContaining({
      env: expect.objectContaining({ AMAZON_ASSOCIATE_TAG: 'crpablo0d-20' }),
    }),
    expect.any(Function),
  );
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/mercadolivre/affiliateLink.test.ts`
Expected: FAIL — `affiliateLink.ts` ainda não repassa `AMAZON_ASSOCIATE_TAG` nem mapeia `AMAZON_CREDENTIALS_MISSING`, e `marketplace === 'amazon'` cai no fallback `'mercadolivre'`.

- [ ] **Step 3: Write the implementation**

Em `src/lib/mercadolivre/affiliateLink.ts`, dentro de `fetchProductAndAffiliateLink`, troque:

```typescript
    const result = await runScript(productLink, {
      ...process.env,
      ML_SESSION_PATH: sessionPath,
      SHOPEE_APP_ID: process.env.SHOPEE_APP_ID ?? '',
      SHOPEE_SECRET_KEY: process.env.SHOPEE_SECRET_KEY ?? '',
    });
```

por:

```typescript
    const result = await runScript(productLink, {
      ...process.env,
      ML_SESSION_PATH: sessionPath,
      SHOPEE_APP_ID: process.env.SHOPEE_APP_ID ?? '',
      SHOPEE_SECRET_KEY: process.env.SHOPEE_SECRET_KEY ?? '',
      AMAZON_ASSOCIATE_TAG: process.env.AMAZON_ASSOCIATE_TAG ?? '',
    });
```

Troque:

```typescript
    if (stderr.includes('SHOPEE_API_ERROR')) {
      throw new Error(`Falha ao gerar link de afiliado da Shopee: ${stderr.slice(0, 300)}`);
    }
    throw new Error(`Falha ao gerar link de afiliado: ${stderr.slice(0, 500)}`);
```

por:

```typescript
    if (stderr.includes('SHOPEE_API_ERROR')) {
      throw new Error(`Falha ao gerar link de afiliado da Shopee: ${stderr.slice(0, 300)}`);
    }
    if (stderr.includes('AMAZON_CREDENTIALS_MISSING')) {
      throw new Error('Variáveis de ambiente da Amazon ausentes: AMAZON_ASSOCIATE_TAG');
    }
    throw new Error(`Falha ao gerar link de afiliado: ${stderr.slice(0, 500)}`);
```

Note que a checagem de `stderr.includes('AMAZON_CREDENTIALS_MISSING')` precisa vir **antes** do `throw` genérico final, mas a ordem em relação às outras checagens (`SESSION_EXPIRED`, `PRODUCT_NOT_FOUND`, etc.) não importa — os marcadores são mutuamente exclusivos.

Por fim, troque:

```typescript
  const marketplace = parsed.marketplace === 'shopee' ? 'shopee' : 'mercadolivre';
```

por:

```typescript
  const marketplace =
    parsed.marketplace === 'shopee' ? 'shopee' : parsed.marketplace === 'amazon' ? 'amazon' : 'mercadolivre';
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/mercadolivre/affiliateLink.test.ts`
Expected: PASS (todos os testes, incluindo os de Mercado Livre/Shopee que não mudaram)

- [ ] **Step 5: Rodar a suíte inteira e o typecheck**

Run: `npm test && npm run typecheck`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/lib/mercadolivre/affiliateLink.ts src/lib/mercadolivre/affiliateLink.test.ts
git commit -m "feat: affiliateLink repassa AMAZON_ASSOCIATE_TAG e reconhece marketplace amazon"
```

---

### Task 5: Allowlist de imagem — CDN da Amazon nos proxies de Story e TikTok

**Files:**
- Modify: `src/app/api/story-image/route.tsx`
- Modify: `src/app/api/story-image/route.test.ts`
- Modify: `src/app/api/tiktok-image-proxy/route.ts`
- Modify: `src/app/api/tiktok-image-proxy/route.test.ts`

**Interfaces:**
- Nenhuma interface nova — `isAllowedImageHost` (função interna de cada arquivo) passa a aceitar dois domínios de CDN a mais.

- [ ] **Step 1: Write the failing tests**

Em `src/app/api/story-image/route.test.ts`, adicione (mesmo padrão do teste `'aceita imageUrl de host susercontent.com (Shopee)...'` já existente):

```typescript
// src/app/api/story-image/route.test.ts (adicionar dentro do describe existente)
it('aceita imageUrl de host media-amazon.com (Amazon) sem cair no erro de host não permitido', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404 }));

  const request = new Request(
    'https://promopost.example.com/api/story-image?imageUrl=' +
      encodeURIComponent('https://m.media-amazon.com/images/I/abc.jpg') +
      '&title=Produto&price=99.9',
  );
  const response = await GET(request);
  const json = await response.json();

  expect(response.status).not.toBe(400);
  expect(json?.erro).not.toBe('Host da imagem não permitido');
});
```

Em `src/app/api/tiktok-image-proxy/route.test.ts`, adicione (mesmo padrão do teste `'busca e normaliza imagem de host susercontent.com (Shopee)...'` já existente):

```typescript
// src/app/api/tiktok-image-proxy/route.test.ts (adicionar dentro do describe existente)
it('busca e normaliza imagem de host media-amazon.com (Amazon) sem cair no erro de host não permitido', async () => {
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
      encodeURIComponent('https://m.media-amazon.com/images/I/abc.jpg'),
  );
  const response = await GET(request);
  const body = new Uint8Array(await response.arrayBuffer());

  expect(response.status).toBe(200);
  expect(response.headers.get('content-type')).toBe('image/jpeg');
  expect(body).toEqual(JPEG_OUTPUT_BYTES);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/app/api/story-image/route.test.ts src/app/api/tiktok-image-proxy/route.test.ts`
Expected: FAIL nos dois novos testes — `media-amazon.com` ainda não está na allowlist de nenhum dos dois arquivos.

- [ ] **Step 3: Write the implementation**

Em `src/app/api/story-image/route.tsx`, troque:

```typescript
const ALLOWED_IMAGE_HOSTS = [/(^|\.)mlstatic\.com$/i, /(^|\.)susercontent\.com$/i];
```

por:

```typescript
const ALLOWED_IMAGE_HOSTS = [
  /(^|\.)mlstatic\.com$/i,
  /(^|\.)susercontent\.com$/i,
  /(^|\.)media-amazon\.com$/i,
  /(^|\.)ssl-images-amazon\.com$/i,
];
```

Em `src/app/api/tiktok-image-proxy/route.ts`, troque a mesma linha pelo mesmo array (duplicação intencional entre os dois arquivos, já existente antes desta task):

```typescript
const ALLOWED_IMAGE_HOSTS = [/(^|\.)mlstatic\.com$/i, /(^|\.)susercontent\.com$/i];
```

por:

```typescript
const ALLOWED_IMAGE_HOSTS = [
  /(^|\.)mlstatic\.com$/i,
  /(^|\.)susercontent\.com$/i,
  /(^|\.)media-amazon\.com$/i,
  /(^|\.)ssl-images-amazon\.com$/i,
];
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/app/api/story-image/route.test.ts src/app/api/tiktok-image-proxy/route.test.ts`
Expected: PASS (todos os testes, incluindo os de `mlstatic.com`/`susercontent.com` que não mudaram)

- [ ] **Step 5: Rodar a suíte inteira e o typecheck**

Run: `npm test && npm run typecheck`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/app/api/story-image/route.tsx src/app/api/story-image/route.test.ts src/app/api/tiktok-image-proxy/route.ts src/app/api/tiktok-image-proxy/route.test.ts
git commit -m "feat: allowlist de imagem aceita CDN da Amazon (media-amazon.com, ssl-images-amazon.com)"
```

---

## Fora deste plano (validação manual, feita ao vivo)

- Configurar `AMAZON_ASSOCIATE_TAG=crpablo0d-20` no `.env` do VPS e reiniciar o container (`docker compose up -d`, sem rebuild).
- Validação manual com 2-3 links reais da Amazon — maior chance de precisar ajuste aqui do que nos marketplaces anteriores (risco de bloqueio anti-bot documentado no spec). Se a Amazon bloquear o Chromium headless mesmo com a configuração de user-agent/`navigator.webdriver` já usada pro Mercado Livre, isso vira uma investigação nova, fora do escopo deste plano.
- Confirmar que o domínio real de CDN de imagem da Amazon bate com `media-amazon.com`/`ssl-images-amazon.com` (Task 5 assume esses dois por serem os mais comuns hoje, mas só a extração real confirma).
