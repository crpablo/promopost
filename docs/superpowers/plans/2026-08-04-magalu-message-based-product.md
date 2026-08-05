# Magalu Message-Based Product Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Substituir o scraping da página de produto do Magalu (bloqueado por Akamai Bot Manager) por uma abordagem que monta o produto inteiramente a partir da mensagem do Telegram — título e preço extraídos por LLM do texto, foto baixada da própria mensagem com a marca d'água de outro divulgador coberta.

**Architecture:** `extractPromo.ts` passa a extrair `title`/`originalPrice` do texto. O poller, só quando o link é do Magalu, baixa a foto anexada à mensagem, cobre a marca d'água (posição fixa, confirmada com o usuário) e hospeda numa rota nova. O webhook ganha um atalho que, pra link do Magalu, monta o produto direto do corpo da requisição e nunca chama o script Playwright — `buildMagaluAffiliateLink` migra pra um módulo TypeScript puro, e a automação de navegador que nunca vai rodar (adicionada na integração anterior) é removida.

**Tech Stack:** TypeScript, sharp (composição de imagem), teleproto/GramJS (download de mídia), Vitest.

## Global Constraints

- Posição da marca d'água (retângulo de cobertura): canto inferior esquerdo, 38% da largura × 14% da altura da imagem, calculado proporcionalmente (não pixel fixo) a partir de `sharp(...).metadata()`. Texto de cobertura: `@tobiestore`, branco sobre fundo preto.
- Arquivo da foto tratada salvo em `DATA_DIR/telegram-media/{messageId}.jpg`, servido publicamente em `GET /api/telegram-media?id={messageId}` (sem segredo, mesmo padrão de `/api/coupon-image`). Parâmetro `id` validado contra `^\d+$` antes de tocar o disco.
- `PromoExtraction` ganha `title: string | null` e `originalPrice: number | null`.
- Corpo do `POST /api/webhook` ganha `title?: string`, `originalPrice?: number`, `photoUrl?: string`.
- Pro produto do Magalu: `product.price = originalPrice ?? discountedPrice`. `discountedPrice` só é repassado pros construtores de legenda/artigo quando `originalPrice` também está presente (senão o preço único já é tratado como o preço final, sem linha de desconto).
- `MAGALU_PARTNER_ID`/`MAGALU_PROMOTER_ID` já existem como variáveis de ambiente (configuradas na integração anterior) — sem mudança de nome.
- `buildMagaluAffiliateLink`/`isMagaluLink` migram pra `src/lib/magalu/affiliateLink.ts` (módulo TypeScript puro, sem Playwright).

---

### Task 1: `extractPromo.ts` ganha título e preço original

**Files:**
- Modify: `src/lib/telegram/extractPromo.ts`
- Modify: `src/lib/telegram/extractPromo.test.ts`

**Interfaces:**
- Produces (usado pela Task 6): `PromoExtraction` ganha `title: string | null` e `originalPrice: number | null`.

- [ ] **Step 1: Write the failing test**

Adicione ao final do `describe('extractPromo', ...)` em `src/lib/telegram/extractPromo.test.ts`:

```typescript
// src/lib/telegram/extractPromo.test.ts (adicionar dentro do describe já existente)
  it('extrai title e originalPrice de uma promo do Magalu com preço de/por', async () => {
    generateObjectMock.mockResolvedValue({
      object: {
        isPromo: true,
        link: 'https://www.magazineluiza.com.br/cama-box-king-box-colchao-gazin/divulgador/oferta/229971100/co/cmbx/',
        coupon: null,
        discountedPrice: 2973.49,
        title: 'Gazin Cama Box King Mola',
        originalPrice: 4469.8,
      },
    });

    const result = await extractPromo(
      'ACORDAR RENOVADO É O QUE VOCÊ MERECE TODO DIA\n✅ Gazin Cama Box King Mola\n🔥 DE 4.469,80 | POR 2.973,49\nhttps://www.magazineluiza.com.br/cama-box-king-box-colchao-gazin/divulgador/oferta/229971100/co/cmbx/',
    );

    expect(result).toEqual({
      isPromo: true,
      link: 'https://www.magazineluiza.com.br/cama-box-king-box-colchao-gazin/divulgador/oferta/229971100/co/cmbx/',
      coupon: null,
      discountedPrice: 2973.49,
      title: 'Gazin Cama Box King Mola',
      originalPrice: 4469.8,
    });
  });

  it('extrai title e originalPrice nulos quando a promo não é do Magalu', async () => {
    generateObjectMock.mockResolvedValue({
      object: {
        isPromo: true,
        link: 'https://www.mercadolivre.com.br/produto/p/MLB999',
        coupon: null,
        discountedPrice: null,
        title: null,
        originalPrice: null,
      },
    });

    const result = await extractPromo('Produto legal https://www.mercadolivre.com.br/produto/p/MLB999');

    expect(result.title).toBeNull();
    expect(result.originalPrice).toBeNull();
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/telegram/extractPromo.test.ts`
Expected: FAIL — `PromoSchema`/`PromoExtraction` ainda não têm `title`/`originalPrice`, então `generateObject` (mockado) devolveria um objeto com chaves a mais que o schema real não valida em teste (o mock não passa pelo Zod), mas o `result` comparado via `toEqual` não bate porque a implementação real de `extractPromo` só repassa o que o objeto mockado tem — na verdade FALHA porque as expectativas incluem `title`/`originalPrice`, que a implementação atual do schema não declara e o teste de "não é do Magalu" espera `null` mas a chave nem existe tipada ainda. Rode o comando pra confirmar a falha exata antes de prosseguir.

- [ ] **Step 3: Write the implementation**

Em `src/lib/telegram/extractPromo.ts`, troque `PromoSchema` e `PromoExtraction`:

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
  title: z.string().nullable(),
  originalPrice: z.number().nullable(),
});

export interface PromoExtraction {
  isPromo: boolean;
  link: string | null;
  coupon: string | null;
  discountedPrice: number | null;
  discountPercent: number | null;
  minPurchaseValue: number | null;
  maxDiscountValue: number | null;
  title: string | null;
  originalPrice: number | null;
}
```

Troque a última linha de `PROMPT_INSTRUCTIONS` (a que hoje termina em `use null.` antes do parágrafo final) — adicione duas instruções novas antes do parágrafo final, e troque o parágrafo final:

```typescript
// src/lib/telegram/extractPromo.ts (troca o final de PROMPT_INSTRUCTIONS)
- maxDiscountValue: o valor máximo de desconto que o cupom concede (ex: "desconto máximo de R$30" → 30), como número. Se não houver valor máximo mencionado, use null.
- title: o título/nome do produto mencionado na mensagem (ex: "Gazin Cama Box King Mola"), como aparece no texto. Se a mensagem não deixar claro um título específico de produto, use null.
- originalPrice: o preço original mencionado na mensagem (o valor "de", antes do desconto), como número (ex: 4469.80). Se a mensagem não mencionar um preço original separado do preço final, use null.

Se a mensagem não for sobre uma promoção do Mercado Livre, da Shopee, da Amazon nem do Magalu (ex: é conversa comum, ou é promoção de outro site/marketplace), retorne isPromo: false e os demais campos null.`;
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/telegram/extractPromo.test.ts`
Expected: PASS (todos os testes, incluindo os 2 novos).

- [ ] **Step 5: Run the full test suite and typecheck**

Run: `npx vitest run`
Expected: todos os testes passando.

Run: `npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 6: Commit**

```bash
git add src/lib/telegram/extractPromo.ts src/lib/telegram/extractPromo.test.ts
git commit -m "feat: extractPromo captura titulo e preco original pro Magalu"
```

---

### Task 2: `src/lib/magalu/affiliateLink.ts` — módulo TypeScript puro

**Files:**
- Create: `src/lib/magalu/affiliateLink.ts`
- Create: `src/lib/magalu/affiliateLink.test.ts`

**Interfaces:**
- Produces (usado pelas Tasks 6 e 8): `export function isMagaluLink(link: string): boolean`, `export function buildMagaluAffiliateLink(url: string, partnerId: string, promoterId: string): string`.

- [ ] **Step 1: Write the failing tests**

Crie `src/lib/magalu/affiliateLink.test.ts`:

```typescript
// src/lib/magalu/affiliateLink.test.ts
import { describe, expect, it } from 'vitest';
import { buildMagaluAffiliateLink, isMagaluLink } from './affiliateLink';

describe('isMagaluLink', () => {
  it('reconhece um link do domínio magazineluiza.com.br', () => {
    expect(isMagaluLink('https://www.magazineluiza.com.br/produto-x/p/abc123/')).toBe(true);
  });

  it('rejeita links de outros marketplaces', () => {
    expect(isMagaluLink('https://www.mercadolivre.com.br/produto/p/MLB123')).toBe(false);
    expect(isMagaluLink('https://shopee.com.br/produto-x')).toBe(false);
    expect(isMagaluLink('https://www.amazon.com.br/dp/B08XYZ')).toBe(false);
  });

  it('retorna false pra URL malformada em vez de lançar', () => {
    expect(isMagaluLink('não é uma url')).toBe(false);
  });
});

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

Run: `npx vitest run src/lib/magalu/affiliateLink.test.ts`
Expected: FAIL — `Failed to resolve import "./affiliateLink"` (o módulo ainda não existe).

- [ ] **Step 3: Write the implementation**

Crie `src/lib/magalu/affiliateLink.ts`:

```typescript
// src/lib/magalu/affiliateLink.ts
export function isMagaluLink(link: string): boolean {
  try {
    return /(^|\.)magazineluiza\.com\.br$/i.test(new URL(link).hostname);
  } catch {
    return false;
  }
}

// Gera o link de afiliado do Magalu sem nenhuma chamada de rede — sobrescreve
// (ou adiciona, se ainda não existirem) os parâmetros partner_id, promoter_id
// e utm_source/utm_medium/utm_campaign na própria URL resolvida do produto.
// O link que já circula no canal de origem tem esse mesmo formato, só que
// com os valores do afiliado que postou — aqui trocamos pelos nossos, pra
// garantir que o crédito da venda vá pra nossa conta, nunca a de quem
// postou originalmente (confirmado com o usuário, 2026-08-04).
export function buildMagaluAffiliateLink(url: string, partnerId: string, promoterId: string): string {
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

Run: `npx vitest run src/lib/magalu/affiliateLink.test.ts`
Expected: PASS (todos os 7 testes).

- [ ] **Step 5: Run the full test suite and typecheck**

Run: `npx vitest run`
Expected: todos os testes passando.

Run: `npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 6: Commit**

```bash
git add src/lib/magalu/affiliateLink.ts src/lib/magalu/affiliateLink.test.ts
git commit -m "feat: modulo TypeScript puro isMagaluLink/buildMagaluAffiliateLink"
```

---

### Task 3: `src/lib/magalu/photoOverlay.ts` — cobre a marca d'água

**Files:**
- Create: `src/lib/magalu/photoOverlay.ts`
- Create: `src/lib/magalu/photoOverlay.test.ts`

**Interfaces:**
- Produces (usado pela Task 7): `export function coverWatermark(imageBuffer: Buffer): Promise<Buffer>` — recebe os bytes da foto original, devolve um JPEG com um retângulo preto + "@tobiestore" cobrindo o canto inferior esquerdo (38% largura × 14% altura, proporcional ao tamanho da imagem).

- [ ] **Step 1: Write the failing test**

Crie `src/lib/magalu/photoOverlay.test.ts`:

```typescript
// src/lib/magalu/photoOverlay.test.ts
import { describe, expect, it, vi } from 'vitest';

const { compositeMock, jpegMock, toBufferMock, metadataMock, sharpMock } = vi.hoisted(() => {
  const toBufferMock = vi.fn();
  const jpegMock = vi.fn(() => ({ toBuffer: toBufferMock }));
  const compositeMock = vi.fn(() => ({ jpeg: jpegMock }));
  const metadataMock = vi.fn();
  const sharpMock = vi.fn(() => ({ metadata: metadataMock, composite: compositeMock }));
  return { compositeMock, jpegMock, toBufferMock, metadataMock, sharpMock };
});

vi.mock('sharp', () => ({ default: sharpMock }));

import { coverWatermark } from './photoOverlay';

describe('coverWatermark', () => {
  it('composita um retângulo no canto inferior esquerdo, proporcional ao tamanho da imagem', async () => {
    metadataMock.mockResolvedValue({ width: 1000, height: 1000 });
    toBufferMock.mockResolvedValue(Buffer.from([9, 9, 9]));

    const result = await coverWatermark(Buffer.from([1, 2, 3]));

    expect(sharpMock).toHaveBeenCalledWith(Buffer.from([1, 2, 3]));
    expect(compositeMock).toHaveBeenCalledWith([
      expect.objectContaining({ top: 860, left: 0 }),
    ]);
    expect(jpegMock).toHaveBeenCalledWith({ quality: 90 });
    expect(result).toEqual(Buffer.from([9, 9, 9]));
  });

  it('escala a região coberta proporcionalmente pra uma imagem de tamanho diferente', async () => {
    metadataMock.mockResolvedValue({ width: 2000, height: 1500 });
    toBufferMock.mockResolvedValue(Buffer.from([9]));

    await coverWatermark(Buffer.from([1]));

    expect(compositeMock).toHaveBeenCalledWith([expect.objectContaining({ top: 1290, left: 0 })]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/magalu/photoOverlay.test.ts`
Expected: FAIL — `Failed to resolve import "./photoOverlay"` (o módulo ainda não existe).

- [ ] **Step 3: Write the implementation**

Crie `src/lib/magalu/photoOverlay.ts`:

```typescript
// src/lib/magalu/photoOverlay.ts
import sharp from 'sharp';

// Marca d'água (selo de avaliação + "@promozoneoficial") do canal de origem
// sempre aparece no canto inferior esquerdo da imagem, numa faixa que cobre
// aproximadamente 38% da largura e 14% da altura a partir do canto —
// confirmado pelo usuário com múltiplos exemplos reais do canal, 2026-08-04.
// Usa proporção (não pixel fixo) porque as imagens desse bot variam de
// tamanho entre mensagens, mas mantêm a mesma disposição relativa. Esses
// valores são um primeiro ajuste — precisam de validação visual contra
// fotos reais baixadas do canal antes de considerar definitivo.
const WATERMARK_WIDTH_RATIO = 0.38;
const WATERMARK_HEIGHT_RATIO = 0.14;
const OVERLAY_LABEL = '@tobiestore';

export async function coverWatermark(imageBuffer: Buffer): Promise<Buffer> {
  const image = sharp(imageBuffer);
  const metadata = await image.metadata();
  const width = metadata.width ?? 0;
  const height = metadata.height ?? 0;

  const overlayWidth = Math.round(width * WATERMARK_WIDTH_RATIO);
  const overlayHeight = Math.round(height * WATERMARK_HEIGHT_RATIO);
  const overlayTop = height - overlayHeight;
  const overlayLeft = 0;

  const overlaySvg = Buffer.from(
    `<svg width="${overlayWidth}" height="${overlayHeight}">
      <rect width="100%" height="100%" fill="black" />
      <text x="12" y="${overlayHeight / 2}" fill="white" font-size="${Math.round(overlayHeight * 0.35)}" font-family="sans-serif" dominant-baseline="middle">${OVERLAY_LABEL}</text>
    </svg>`,
  );

  return image
    .composite([{ input: overlaySvg, top: overlayTop, left: overlayLeft }])
    .jpeg({ quality: 90 })
    .toBuffer();
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/magalu/photoOverlay.test.ts`
Expected: PASS (os 2 testes).

- [ ] **Step 5: Run the full test suite and typecheck**

Run: `npx vitest run`
Expected: todos os testes passando.

Run: `npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 6: Commit**

```bash
git add src/lib/magalu/photoOverlay.ts src/lib/magalu/photoOverlay.test.ts
git commit -m "feat: coverWatermark cobre marca dagua da foto do Magalu"
```

---

### Task 4: `localStore.ts` ganha `writeBufferFile`

**Files:**
- Modify: `src/lib/storage/localStore.ts`
- Modify: `src/lib/storage/localStore.test.ts`

**Interfaces:**
- Produces (usado pela Task 7): `export async function writeBufferFile(filename: string, data: Buffer): Promise<void>` — cria o diretório completo do caminho (suporta subpastas como `telegram-media/`) e grava o buffer.

- [ ] **Step 1: Write the failing test**

Este arquivo de teste usa um padrão específico: `import('./localStore')` dinâmico dentro de cada `it` (não um import estático no topo), com `DATA_DIR` apontando pra um diretório temporário real criado no `beforeEach` (ver `mkdtemp`/`vi.stubEnv('DATA_DIR', dataDir)` já no topo do arquivo) — siga exatamente esse padrão. Adicione este teste novo dentro do `describe('readBufferFile', ...)` já existente em `src/lib/storage/localStore.test.ts`, antes do `});` de fechamento desse describe:

```typescript
// src/lib/storage/localStore.test.ts (adicionar dentro do describe('readBufferFile', ...) já existente)
  it('writeBufferFile grava em subpasta que ainda não existe, e readBufferFile lê de volta', async () => {
    const { readBufferFile, writeBufferFile } = await import('./localStore');
    const buffer = Buffer.from([1, 2, 3, 4]);

    await writeBufferFile('telegram-media/123.jpg', buffer);
    const result = await readBufferFile('telegram-media/123.jpg');

    expect(result).toEqual(buffer);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/storage/localStore.test.ts`
Expected: FAIL — `writeBufferFile` não existe ainda (erro de import/tipo).

- [ ] **Step 3: Write the implementation**

Em `src/lib/storage/localStore.ts`, adicione `dirname` ao import do topo:

```typescript
// src/lib/storage/localStore.ts (topo do arquivo)
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
```

Adicione a função nova, logo depois de `readBufferFile`:

```typescript
// src/lib/storage/localStore.ts (adicionar depois de readBufferFile)
export async function writeBufferFile(filename: string, data: Buffer): Promise<void> {
  const fullPath = resolveDataPath(filename);
  await mkdir(path.dirname(fullPath), { recursive: true });
  await writeFile(fullPath, data);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/storage/localStore.test.ts`
Expected: PASS (todos os testes, incluindo o novo).

- [ ] **Step 5: Run the full test suite and typecheck**

Run: `npx vitest run`
Expected: todos os testes passando.

Run: `npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 6: Commit**

```bash
git add src/lib/storage/localStore.ts src/lib/storage/localStore.test.ts
git commit -m "feat: writeBufferFile em localStore, com suporte a subpasta"
```

---

### Task 5: Rota `/api/telegram-media`

**Files:**
- Create: `src/app/api/telegram-media/route.ts`
- Create: `src/app/api/telegram-media/route.test.ts`

**Interfaces:**
- Consumes (da Task 4): `readBufferFile` de `@/lib/storage/localStore` (já existe, sem mudança).
- Produces (usado pela Task 7, como formato de URL): `GET /api/telegram-media?id={messageId}` → 200 com `image/jpeg` se o arquivo existir, 404 se não, 400 se `id` ausente ou não for um inteiro positivo.

- [ ] **Step 1: Write the failing tests**

Crie `src/app/api/telegram-media/route.test.ts`:

```typescript
// src/app/api/telegram-media/route.test.ts
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/storage/localStore', () => ({ readBufferFile: vi.fn() }));

import { readBufferFile } from '@/lib/storage/localStore';
import { GET } from './route';

describe('GET /api/telegram-media', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('retorna 400 quando falta o parâmetro id', async () => {
    const request = new Request('https://promopost.example.com/api/telegram-media');
    const response = await GET(request);

    expect(response.status).toBe(400);
  });

  it('retorna 400 quando id não é um inteiro positivo', async () => {
    const request = new Request('https://promopost.example.com/api/telegram-media?id=abc');
    const response = await GET(request);

    expect(response.status).toBe(400);
  });

  it('retorna 404 quando o arquivo não existe', async () => {
    vi.mocked(readBufferFile).mockResolvedValue(null);

    const request = new Request('https://promopost.example.com/api/telegram-media?id=123');
    const response = await GET(request);

    expect(response.status).toBe(404);
  });

  it('retorna 200 com content-type image/jpeg quando o arquivo existe', async () => {
    vi.mocked(readBufferFile).mockResolvedValue(Buffer.from([1, 2, 3]));

    const request = new Request('https://promopost.example.com/api/telegram-media?id=123');
    const response = await GET(request);
    const body = new Uint8Array(await response.arrayBuffer());

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('image/jpeg');
    expect(body).toEqual(new Uint8Array([1, 2, 3]));
    expect(readBufferFile).toHaveBeenCalledWith('telegram-media/123.jpg');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/app/api/telegram-media/route.test.ts`
Expected: FAIL — `Failed to resolve import "./route"` (a rota ainda não existe).

- [ ] **Step 3: Write the implementation**

Crie `src/app/api/telegram-media/route.ts`:

```typescript
// src/app/api/telegram-media/route.ts
import { readBufferFile } from '@/lib/storage/localStore';

export async function GET(request: Request): Promise<Response> {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');

  if (!id || !/^\d+$/.test(id)) {
    return Response.json({ erro: 'Parâmetro id inválido' }, { status: 400 });
  }

  const buffer = await readBufferFile(`telegram-media/${id}.jpg`);
  if (!buffer) {
    return Response.json({ erro: 'Imagem não encontrada' }, { status: 404 });
  }

  return new Response(new Uint8Array(buffer), {
    status: 200,
    headers: { 'content-type': 'image/jpeg' },
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/app/api/telegram-media/route.test.ts`
Expected: PASS (todos os 4 testes).

- [ ] **Step 5: Run the full test suite and typecheck**

Run: `npx vitest run`
Expected: todos os testes passando.

Run: `npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 6: Commit**

```bash
git add src/app/api/telegram-media/route.ts src/app/api/telegram-media/route.test.ts
git commit -m "feat: rota publica /api/telegram-media pra servir foto tratada"
```

---

### Task 6: `poller.ts` — download condicional da foto

**Files:**
- Modify: `src/lib/telegram/poller.ts`
- Modify: `src/lib/telegram/poller.test.ts`

**Interfaces:**
- Consumes (da Task 2): `isMagaluLink` de `../magalu/affiliateLink`. Consumes (da Task 1): `PromoExtraction` com `title`/`originalPrice`.
- Produces (usado pela Task 7): `PollerDeps` ganha `downloadMessagePhoto: (messageId: number) => Promise<string | null>`. `callWebhook`'s body ganha `title?: string`, `originalPrice?: number`, `photoUrl?: string`.

- [ ] **Step 1: Write the failing tests**

Em `src/lib/telegram/poller.test.ts`, adicione `downloadMessagePhoto: vi.fn().mockResolvedValue(null),` dentro do objeto retornado por `makeDeps` (junto aos outros deps já listados, como `callWebhook`):

```typescript
// src/lib/telegram/poller.test.ts (dentro de makeDeps, junto aos deps já existentes)
    callWebhook: vi.fn().mockResolvedValue({ ok: true, status: 200 }),
    downloadMessagePhoto: vi.fn().mockResolvedValue(null),
```

Adicione estes dois testes novos ao final do `describe('pollTelegram', ...)`, antes do `});` de fechamento:

```typescript
// src/lib/telegram/poller.test.ts (adicionar ao final do describe já existente)
  it('baixa a foto e repassa title/originalPrice/photoUrl quando o link é do Magalu', async () => {
    const deps = makeDeps({
      fetchNewMessages: vi.fn().mockResolvedValue([{ id: 55, text: 'promo magalu' }]),
      extractPromo: vi.fn().mockResolvedValue({
        isPromo: true,
        link: 'https://www.magazineluiza.com.br/produto-x/p/abc123/',
        coupon: null,
        discountedPrice: 89.9,
        title: 'Carregador Portátil',
        originalPrice: 129.9,
      }),
      downloadMessagePhoto: vi.fn().mockResolvedValue('https://promopost.example.com/api/telegram-media?id=55'),
    });

    await pollTelegram(deps);

    expect(deps.downloadMessagePhoto).toHaveBeenCalledWith(55);
    expect(deps.callWebhook).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Carregador Portátil',
        originalPrice: 129.9,
        photoUrl: 'https://promopost.example.com/api/telegram-media?id=55',
      }),
    );
  });

  it('não baixa foto quando o link não é do Magalu', async () => {
    const deps = makeDeps({
      fetchNewMessages: vi.fn().mockResolvedValue([{ id: 56, text: 'promo ML' }]),
      extractPromo: vi.fn().mockResolvedValue({
        isPromo: true,
        link: 'https://www.mercadolivre.com.br/produto/p/MLB123',
        coupon: null,
        discountedPrice: null,
        title: null,
        originalPrice: null,
      }),
    });

    await pollTelegram(deps);

    expect(deps.downloadMessagePhoto).not.toHaveBeenCalled();
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/telegram/poller.test.ts`
Expected: FAIL — `runPoll` ainda não chama `downloadMessagePhoto` nem repassa `title`/`originalPrice`/`photoUrl` no corpo do webhook.

- [ ] **Step 3: Write the implementation**

Em `src/lib/telegram/poller.ts`, adicione o import no topo:

```typescript
// src/lib/telegram/poller.ts (topo do arquivo)
import { isMagaluLink } from '../magalu/affiliateLink';
import type { PromoExtraction as PromoExtractionResult } from './extractPromo';
```

Troque `PollerDeps`:

```typescript
// src/lib/telegram/poller.ts
export interface PollerDeps {
  fetchNewMessages: (afterId: number | null) => Promise<TelegramMessage[]>;
  getLatestMessageId: () => Promise<number | null>;
  loadCursor: () => Promise<number | null>;
  saveCursor: (messageId: number) => Promise<void>;
  extractPromo: (text: string) => Promise<PromoExtractionResult>;
  downloadMessagePhoto: (messageId: number) => Promise<string | null>;
  callWebhook: (body: {
    link: string;
    coupon?: string;
    discountedPrice?: number;
    discountPercent?: number;
    minPurchaseValue?: number;
    maxDiscountValue?: number;
    title?: string;
    originalPrice?: number;
    photoUrl?: string;
  }) => Promise<WebhookCallResult>;
  acquireLock: () => Promise<boolean>;
  releaseLock: () => Promise<void>;
  batchLimit?: number;
}
```

Dentro de `runPoll`, troque o bloco que chama `deps.callWebhook` (o que já existe, que monta o objeto com `link`, `coupon`, etc.):

```typescript
// src/lib/telegram/poller.ts (dentro de runPoll, troca o bloco try existente)
    let photoUrl: string | undefined;
    if (isMagaluLink(extraction.link)) {
      photoUrl = (await deps.downloadMessagePhoto(message.id)) ?? undefined;
    }

    try {
      const result = await deps.callWebhook({
        link: extraction.link,
        coupon: extraction.coupon ?? undefined,
        discountedPrice: extraction.discountedPrice ?? undefined,
        discountPercent: extraction.discountPercent ?? undefined,
        minPurchaseValue: extraction.minPurchaseValue ?? undefined,
        maxDiscountValue: extraction.maxDiscountValue ?? undefined,
        title: extraction.title ?? undefined,
        originalPrice: extraction.originalPrice ?? undefined,
        photoUrl,
      });
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/telegram/poller.test.ts`
Expected: PASS (todos os testes, incluindo os 2 novos).

- [ ] **Step 5: Run the full test suite and typecheck**

Run: `npx vitest run`
Expected: todos os testes passando.

Run: `npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 6: Commit**

```bash
git add src/lib/telegram/poller.ts src/lib/telegram/poller.test.ts
git commit -m "feat: poller baixa foto condicionalmente e repassa dados do Magalu"
```

---

### Task 7: `telegram-poll/route.ts` — implementação real de `downloadMessagePhoto`

**Files:**
- Modify: `src/app/api/telegram-poll/route.ts`

**Interfaces:**
- Consumes (das Tasks 3, 4, 6): `coverWatermark` de `@/lib/magalu/photoOverlay`, `writeBufferFile` de `@/lib/storage/localStore`, a assinatura `downloadMessagePhoto: (messageId: number) => Promise<string | null>` já definida em `PollerDeps`.
- Sem teste automatizado — mesma limitação já aceita pro resto da integração GramJS neste arquivo (não há `telegram-poll/route.test.ts`).

- [ ] **Step 1: Add the imports**

Em `src/app/api/telegram-poll/route.ts`, adicione aos imports já existentes:

```typescript
// src/app/api/telegram-poll/route.ts (adicionar junto aos imports já existentes)
import { coverWatermark } from '@/lib/magalu/photoOverlay';
import { writeBufferFile } from '@/lib/storage/localStore';
```

- [ ] **Step 2: Write `downloadMessagePhoto`**

Adicione a função nova, logo depois de `getLatestMessageId`:

```typescript
// src/app/api/telegram-poll/route.ts (adicionar depois de getLatestMessageId)
async function downloadMessagePhoto(messageId: number): Promise<string | null> {
  const { apiId, apiHash, chatId } = readTelegramEnv();
  const sessionString = await loadSession();
  const baseUrl = process.env.WEBHOOK_BASE_URL;
  if (!baseUrl) {
    throw new Error('WEBHOOK_BASE_URL não configurado');
  }

  const client = new TelegramClient(new StringSession(sessionString), apiId, apiHash, {
    connectionRetries: 3,
  });
  await client.connect();

  try {
    await client.getDialogs({ limit: 100 });
    const entity = await client.getEntity(chatId);
    const messages = await client.getMessages(entity, { ids: [messageId] });
    const message = messages[0];
    if (!message || !message.media) {
      return null;
    }

    const buffer = await client.downloadMedia(message);
    if (!buffer || typeof buffer === 'string') {
      return null;
    }

    const covered = await coverWatermark(buffer);
    await writeBufferFile(`telegram-media/${messageId}.jpg`, covered);

    return `${baseUrl}/api/telegram-media?id=${messageId}`;
  } finally {
    await client.disconnect();
  }
}
```

- [ ] **Step 3: Wire it into the `pollTelegram` call**

No `GET` handler, dentro da chamada a `pollTelegram({...})`, adicione `downloadMessagePhoto,` junto aos outros deps já passados:

```typescript
// src/app/api/telegram-poll/route.ts (dentro do GET handler)
    const result = await pollTelegram({
      fetchNewMessages,
      getLatestMessageId,
      loadCursor,
      saveCursor,
      extractPromo,
      downloadMessagePhoto,
      callWebhook,
      acquireLock,
      releaseLock,
    });
```

- [ ] **Step 4: Run the full test suite and typecheck**

Run: `npx vitest run`
Expected: todos os testes passando (nenhum teste novo pra esse arquivo, mas confirma que nada quebrou).

Run: `npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/telegram-poll/route.ts
git commit -m "feat: downloadMessagePhoto baixa e trata foto real do Telegram"
```

---

### Task 8: Webhook publica produto do Magalu direto da mensagem

**Files:**
- Modify: `src/app/api/webhook/route.ts`
- Modify: `src/app/api/webhook/route.test.ts`

**Interfaces:**
- Consumes (da Task 2): `isMagaluLink`, `buildMagaluAffiliateLink` de `@/lib/magalu/affiliateLink`. Consumes: `deleteFile` de `@/lib/storage/localStore` (já existe).

- [ ] **Step 1: Write the failing tests**

Em `src/app/api/webhook/route.test.ts`, adicione o mock e o import de `deleteFile` junto aos já existentes, no topo do arquivo:

```typescript
// src/app/api/webhook/route.test.ts (adicionar junto aos vi.mock já existentes, no topo)
vi.mock('@/lib/storage/localStore', () => ({ deleteFile: vi.fn() }));
```

```typescript
// src/app/api/webhook/route.test.ts (adicionar junto aos imports já existentes)
import { deleteFile } from '@/lib/storage/localStore';
```

Adicione estes 5 testes novos dentro do `describe('POST /api/webhook', ...)`, próximo aos outros testes de caminho feliz:

```typescript
// src/app/api/webhook/route.test.ts (adicionar dentro do describe já existente)
  it('publica produto do Magalu direto da mensagem, sem chamar o pipeline de scraping', async () => {
    stubMetaEnv();
    stubWebhookBaseUrl();
    stubTikTokEnv();
    stubTelegramGroupsEnv();
    vi.stubEnv('MAGALU_PARTNER_ID', '3440');
    vi.stubEnv('MAGALU_PROMOTER_ID', '5784620');
    vi.mocked(buildPostText).mockReturnValue('texto do post');
    vi.mocked(publishArticle).mockResolvedValue({
      url: 'https://loja.myshopify.com/blogs/noticias/carregador-portatil',
    });
    vi.mocked(buildSocialCaption).mockReturnValue('legenda social');
    vi.mocked(postToFacebook).mockResolvedValue({ postId: 'fb-magalu-1' });
    vi.mocked(postToInstagram).mockResolvedValue({ postId: 'ig-magalu-1' });
    vi.mocked(postStoryToInstagram).mockResolvedValue({ postId: 'story-magalu-1' });
    vi.mocked(postToTikTok).mockResolvedValue({ postId: 'tt-magalu-1' });
    vi.mocked(postToTelegramGroups).mockResolvedValue({
      ok: true,
      results: [{ groupId: '-100111', ok: true }],
    });

    const response = await POST(
      makeRequest({
        link: 'https://www.magazineluiza.com.br/carregador-portatil-turbo-power-bank/p/dkba5b776g/te/accp/?partner_id=9999&promoter_id=1111111',
        title: 'Carregador Portátil Turbo Power Bank',
        originalPrice: 129.9,
        discountedPrice: 89.9,
        photoUrl: 'https://promopost.example.com/api/telegram-media?id=55',
      }),
    );
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json).toEqual({
      postUrl: 'https://loja.myshopify.com/blogs/noticias/carregador-portatil',
      facebook: { ok: true, postId: 'fb-magalu-1' },
      instagram: { ok: true, postId: 'ig-magalu-1' },
      story: { ok: true, postId: 'story-magalu-1' },
      tiktok: { ok: true, postId: 'tt-magalu-1' },
      telegram: { ok: true, results: [{ groupId: '-100111', ok: true }] },
    });
    expect(fetchProductAndAffiliateLink).not.toHaveBeenCalled();
    expect(buildPostText).toHaveBeenCalledWith(
      {
        title: 'Carregador Portátil Turbo Power Bank',
        price: 129.9,
        imageUrl: 'https://promopost.example.com/api/telegram-media?id=55',
        marketplace: 'magalu',
      },
      'https://www.magazineluiza.com.br/carregador-portatil-turbo-power-bank/p/dkba5b776g/te/accp/?partner_id=3440&promoter_id=5784620',
      undefined,
      89.9,
    );
    expect(deleteFile).toHaveBeenCalledWith('telegram-media/55.jpg');
  });

  it('usa discountedPrice como preço quando o Magalu não informa originalPrice', async () => {
    stubMetaEnv();
    stubWebhookBaseUrl();
    vi.stubEnv('MAGALU_PARTNER_ID', '3440');
    vi.stubEnv('MAGALU_PROMOTER_ID', '5784620');
    vi.mocked(buildPostText).mockReturnValue('texto do post');
    vi.mocked(publishArticle).mockResolvedValue({ url: 'https://loja.myshopify.com/blogs/noticias/x' });
    vi.mocked(buildSocialCaption).mockReturnValue('legenda social');
    vi.mocked(postToFacebook).mockResolvedValue({ postId: 'fb-1' });
    vi.mocked(postToInstagram).mockResolvedValue({ postId: 'ig-1' });
    vi.mocked(postStoryToInstagram).mockResolvedValue({ postId: 'story-1' });

    await POST(
      makeRequest({
        link: 'https://www.magazineluiza.com.br/produto-x/p/abc123/',
        title: 'Produto X',
        discountedPrice: 59.9,
        photoUrl: 'https://promopost.example.com/api/telegram-media?id=99',
      }),
    );

    expect(buildPostText).toHaveBeenCalledWith(
      {
        title: 'Produto X',
        price: 59.9,
        imageUrl: 'https://promopost.example.com/api/telegram-media?id=99',
        marketplace: 'magalu',
      },
      'https://www.magazineluiza.com.br/produto-x/p/abc123/?partner_id=3440&promoter_id=5784620',
      undefined,
      undefined,
    );
  });

  it('retorna 400 quando o link é do Magalu mas falta title ou photoUrl', async () => {
    const response = await POST(
      makeRequest({ link: 'https://www.magazineluiza.com.br/produto-x/p/abc123/' }),
    );
    const json = await response.json();

    expect(response.status).toBe(400);
    expect(json).toEqual({ erro: 'mensagem do Magalu sem título ou foto — não é possível publicar' });
    expect(fetchProductAndAffiliateLink).not.toHaveBeenCalled();
  });

  it('retorna 400 quando o link é do Magalu mas não tem nenhum preço', async () => {
    const response = await POST(
      makeRequest({
        link: 'https://www.magazineluiza.com.br/produto-x/p/abc123/',
        title: 'Produto X',
        photoUrl: 'https://promopost.example.com/api/telegram-media?id=55',
      }),
    );
    const json = await response.json();

    expect(response.status).toBe(400);
    expect(json).toEqual({ erro: 'mensagem do Magalu sem preço — não é possível publicar' });
  });

  it('retorna 500 e apaga o arquivo da foto quando a publicação do produto do Magalu falha', async () => {
    vi.stubEnv('MAGALU_PARTNER_ID', '3440');
    vi.stubEnv('MAGALU_PROMOTER_ID', '5784620');
    vi.mocked(buildPostText).mockReturnValue('texto do post');
    vi.mocked(publishArticle).mockRejectedValue(new Error('Shopify indisponível'));

    const response = await POST(
      makeRequest({
        link: 'https://www.magazineluiza.com.br/produto-x/p/abc123/',
        title: 'Produto X',
        originalPrice: 99.9,
        photoUrl: 'https://promopost.example.com/api/telegram-media?id=77',
      }),
    );
    const json = await response.json();

    expect(response.status).toBe(500);
    expect(json).toEqual({ erro: 'erro interno ao publicar produto do Magalu' });
    expect(deleteFile).toHaveBeenCalledWith('telegram-media/77.jpg');
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/app/api/webhook/route.test.ts`
Expected: FAIL — o webhook ainda não reconhece link do Magalu de forma especial, cai no fluxo de `runPipeline` (que chama `fetchProductAndAffiliateLink` mockado, sem configuração pra esse cenário) e não bate com as expectativas.

- [ ] **Step 3: Wire the Magalu shortcut into the webhook**

Em `src/app/api/webhook/route.ts`, troque o bloco de imports do topo:

```typescript
// src/app/api/webhook/route.ts (topo do arquivo)
import { buildPostText } from '@/lib/content/template';
import { buildCouponArticleText, buildCouponCaption, type CouponDetails } from '@/lib/content/couponTemplate';
import { buildMagaluAffiliateLink, isMagaluLink } from '@/lib/magalu/affiliateLink';
import { fetchProductAndAffiliateLink } from '@/lib/mercadolivre/affiliateLink';
import type { Product } from '@/lib/marketplace/types';
import { parseItemId } from '@/lib/mercadolivre/parseLink';
import { ListCouponError, PipelineError, runPipeline } from '@/lib/pipeline';
import { publishArticle } from '@/lib/shopify/publisher';
import { buildSocialCaption } from '@/lib/social/caption';
import { postToFacebook } from '@/lib/social/facebook';
import { postStoryToInstagram, postToInstagram } from '@/lib/social/instagram';
import { postToTikTok } from '@/lib/social/tiktok';
import { postToTelegramGroups } from '@/lib/social/telegramGroups';
import type { TelegramGroupsResult } from '@/lib/social/telegramGroups';
import { deleteFile } from '@/lib/storage/localStore';
```

Troque a declaração de `body` e adicione as validações novas, logo depois das validações já existentes (a última é a de `maxDiscountValue`):

```typescript
// src/app/api/webhook/route.ts (troca a declaração de body)
  let body: {
    link?: string;
    coupon?: string;
    discountedPrice?: number;
    discountPercent?: number;
    minPurchaseValue?: number;
    maxDiscountValue?: number;
    title?: string;
    originalPrice?: number;
    photoUrl?: string;
  };
```

```typescript
// src/app/api/webhook/route.ts (logo depois da validação de maxDiscountValue já existente)
  if (body.maxDiscountValue !== undefined && typeof body.maxDiscountValue !== 'number') {
    return Response.json({ erro: 'desconto máximo inválido' }, { status: 400 });
  }
  if (body.title !== undefined && typeof body.title !== 'string') {
    return Response.json({ erro: 'título inválido' }, { status: 400 });
  }
  if (body.originalPrice !== undefined && typeof body.originalPrice !== 'number') {
    return Response.json({ erro: 'preço original inválido' }, { status: 400 });
  }
  if (body.photoUrl !== undefined && typeof body.photoUrl !== 'string') {
    return Response.json({ erro: 'URL de foto inválida' }, { status: 400 });
  }
```

Adicione o atalho do Magalu logo depois dessas validações, antes do `try { const result = await runPipeline(...) }` já existente:

```typescript
// src/app/api/webhook/route.ts (antes do try/runPipeline já existente)
  if (isMagaluLink(body.link)) {
    if (!body.title || !body.photoUrl) {
      return Response.json(
        { erro: 'mensagem do Magalu sem título ou foto — não é possível publicar' },
        { status: 400 },
      );
    }
    const price = body.originalPrice ?? body.discountedPrice;
    if (typeof price !== 'number') {
      return Response.json(
        { erro: 'mensagem do Magalu sem preço — não é possível publicar' },
        { status: 400 },
      );
    }

    const partnerId = process.env.MAGALU_PARTNER_ID;
    const promoterId = process.env.MAGALU_PROMOTER_ID;
    if (!partnerId || !promoterId) {
      return Response.json(
        { erro: 'Variáveis de ambiente do Magalu ausentes: MAGALU_PARTNER_ID, MAGALU_PROMOTER_ID' },
        { status: 500 },
      );
    }

    const photoId = new URL(body.photoUrl).searchParams.get('id');
    const discountedForCaption = body.originalPrice !== undefined ? body.discountedPrice : undefined;

    try {
      const product: Product = {
        title: body.title,
        price,
        imageUrl: body.photoUrl,
        marketplace: 'magalu',
      };
      const affiliateLink = buildMagaluAffiliateLink(body.link, partnerId, promoterId);
      const postBody = buildPostText(product, affiliateLink, body.coupon, discountedForCaption);
      const published = await publishArticle(product.title, postBody, product.imageUrl);
      const { facebook, instagram, story, tiktok, telegram } = await postToSocialNetworks(
        product,
        affiliateLink,
        body.coupon,
        discountedForCaption,
      );

      return Response.json(
        { postUrl: published.url, facebook, instagram, story, tiktok, telegram },
        { status: 200 },
      );
    } catch (err) {
      console.error('Erro ao publicar produto do Magalu:', err);
      return Response.json({ erro: 'erro interno ao publicar produto do Magalu' }, { status: 500 });
    } finally {
      if (photoId) {
        await deleteFile(`telegram-media/${photoId}.jpg`);
      }
    }
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/app/api/webhook/route.test.ts`
Expected: PASS (todos os testes, incluindo os 5 novos).

- [ ] **Step 5: Run the full test suite and typecheck**

Run: `npx vitest run`
Expected: todos os testes passando.

Run: `npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 6: Commit**

```bash
git add src/app/api/webhook/route.ts src/app/api/webhook/route.test.ts
git commit -m "feat: webhook publica produto do Magalu direto da mensagem"
```

---

### Task 9: Remove a automação de navegador morta do Magalu

**Files:**
- Modify: `src/lib/mercadolivre/generate-link.playwright.mjs`
- Modify: `src/lib/mercadolivre/generate-link.playwright.test.ts`
- Modify: `src/lib/mercadolivre/affiliateLink.ts`
- Modify: `src/lib/mercadolivre/affiliateLink.test.ts`

**Interfaces:**
- Nenhuma nova — esse task só remove código que, depois da Task 8, nunca mais é alcançado (o webhook intercepta todo link do Magalu antes de chamar o script Playwright).

- [ ] **Step 1: Remove `buildMagaluAffiliateLink` do script Playwright**

Em `src/lib/mercadolivre/generate-link.playwright.mjs`, **remova** a função inteira (adicionada numa integração anterior, agora duplicada em `src/lib/magalu/affiliateLink.ts`):

```javascript
// REMOVER de src/lib/mercadolivre/generate-link.playwright.mjs:
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

**Remova** a linha de detecção do host:

```javascript
// REMOVER de src/lib/mercadolivre/generate-link.playwright.mjs:
    const isMagalu = /(^|\.)magazineluiza\.com\.br$/i.test(resolvedHost);
```

**Remova** o bloco de checagem de credenciais e **troque** a linha do guard de marketplace não suportado de volta:

```javascript
// REMOVER de src/lib/mercadolivre/generate-link.playwright.mjs:
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

```javascript
// src/lib/mercadolivre/generate-link.playwright.mjs (troca de volta, sem !isMagalu)
    if (!isMercadoLivre && !isShopee && !isAmazon) {
      console.error(`MARKETPLACE_NOT_SUPPORTED (resolvido para: ${resolvedUrl})`);
      process.exit(1);
    }
```

**Remova** o branch de geração de link do Magalu (o `main()` nunca mais processa host do Magalu, então isso é inalcançável):

```javascript
// REMOVER de src/lib/mercadolivre/generate-link.playwright.mjs:
    if (isMagalu) {
      // 2 (Magalu). Sem API, sem sessão — só sobrescreve os parâmetros de
      // afiliado na própria URL resolvida do produto.
      const affiliateLink = buildMagaluAffiliateLink(resolvedUrl, magaluPartnerId, magaluPromoterId);
      console.log(JSON.stringify({ title, price, imageUrl, marketplace: 'magalu', affiliateLink }));
      return;
    }
```

- [ ] **Step 2: Remove os testes de `buildMagaluAffiliateLink` do arquivo antigo**

Em `src/lib/mercadolivre/generate-link.playwright.test.ts`, **remova** o `describe('buildMagaluAffiliateLink', ...)` inteiro (os 3 testes migraram pra `src/lib/magalu/affiliateLink.test.ts` na Task 2) e o import correspondente:

```javascript
// REMOVER de src/lib/mercadolivre/generate-link.playwright.test.ts:
// @ts-expect-error TS7016 — módulo .mjs sem declaração de tipos (allowJs: false no tsconfig)
import { buildMagaluAffiliateLink } from './generate-link.playwright.mjs';

describe('buildMagaluAffiliateLink', () => {
  it('adiciona todos os parâmetros de afiliado numa URL sem nenhum deles', () => {
    // ... (3 testes, ver conteúdo atual do arquivo)
  });
});
```

- [ ] **Step 3: Remove o mapeamento de Magalu de `affiliateLink.ts`**

Em `src/lib/mercadolivre/affiliateLink.ts`, **remova** as duas linhas de env passadas pro processo filho:

```typescript
// REMOVER de src/lib/mercadolivre/affiliateLink.ts (dentro do objeto passado pra runScript):
      MAGALU_PARTNER_ID: process.env.MAGALU_PARTNER_ID ?? '',
      MAGALU_PROMOTER_ID: process.env.MAGALU_PROMOTER_ID ?? '',
```

**Remova** o bloco de mapeamento de stderr:

```typescript
// REMOVER de src/lib/mercadolivre/affiliateLink.ts:
    if (stderr.includes('MAGALU_CREDENTIALS_MISSING')) {
      throw new Error('Variáveis de ambiente do Magalu ausentes: MAGALU_PARTNER_ID, MAGALU_PROMOTER_ID');
    }
```

**Troque** a expressão de `marketplace` de volta:

```typescript
// src/lib/mercadolivre/affiliateLink.ts (troca de volta, sem o branch de magalu)
  const marketplace =
    parsed.marketplace === 'shopee' ? 'shopee' : parsed.marketplace === 'amazon' ? 'amazon' : 'mercadolivre';
```

- [ ] **Step 4: Remove os testes de Magalu de `affiliateLink.test.ts`**

Em `src/lib/mercadolivre/affiliateLink.test.ts`, **remova** os 3 testes adicionados na integração anterior:

```typescript
// REMOVER de src/lib/mercadolivre/affiliateLink.test.ts:
  it('retorna produto do Magalu com marketplace correto quando o script termina com sucesso', async () => {
    // ...
  });

  it('lança erro quando o script reporta MAGALU_CREDENTIALS_MISSING no stderr', async () => {
    // ...
  });

  it('passa MAGALU_PARTNER_ID e MAGALU_PROMOTER_ID como env vars pro processo filho', async () => {
    // ...
  });
```

- [ ] **Step 5: Run the full test suite and typecheck**

Run: `npx vitest run`
Expected: todos os testes passando (a contagem total cai, já que testes duplicados foram removidos — isso é esperado).

Run: `npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 6: Commit**

```bash
git add src/lib/mercadolivre/generate-link.playwright.mjs src/lib/mercadolivre/generate-link.playwright.test.ts src/lib/mercadolivre/affiliateLink.ts src/lib/mercadolivre/affiliateLink.test.ts
git commit -m "refactor: remove automacao Playwright morta do Magalu (substituida por fluxo baseado em mensagem)"
```
