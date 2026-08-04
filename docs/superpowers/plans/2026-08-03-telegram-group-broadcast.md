# Disparo de promoções pra grupos do Telegram Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Além de Facebook, Instagram e TikTok, disparar cada promoção publicada também como mensagem de foto+legenda pra uma lista configurável de grupos do Telegram, reaproveitando a sessão GramJS já autenticada (sem credencial nova).

**Architecture:** Novo arquivo `src/lib/social/telegramGroups.ts` com duas partes: um orquestrador puro e testável (`sendToTelegramGroups`, recebe a função de envio injetada — mesmo padrão de `PollerDeps` em `poller.ts`) e a função de produção (`postToTelegramGroups`, sem dependências injetadas — abre **uma** conexão GramJS, envia pra cada grupo, desconecta) que o webhook chama diretamente, no mesmo padrão de `postToFacebook`/`postToInstagram`/`postToTikTok`. `src/app/api/webhook/route.ts` ganha um quinto branch no `Promise.all` de `postToSocialNetworks`.

**Tech Stack:** Node.js, TypeScript, `teleproto` (GramJS, já uma dependência do projeto), Vitest — nenhuma dependência nova.

## Global Constraints

- Nova env var: `TELEGRAM_TARGET_GROUP_IDS` — lista de IDs de chat separados por vírgula (ex: `-100111,-100222`). Vazia/ausente → canal reporta `{ok: false, results: []}` sem tentar conectar.
- Legenda reaproveitada sem mudança: mesma `buildSocialCaption()` já usada em Facebook/Instagram/TikTok — nenhuma variação de texto pro Telegram.
- Uma única conexão GramJS por chamada (não uma por grupo) — conecta, envia pra todos os grupos da lista em sequência, desconecta. Reaproveita `loadSession()` (`src/lib/telegram/sessionStore.ts`, já existe) e o padrão já usado em `src/app/api/telegram-poll/route.ts` de chamar `client.getDialogs({ limit: 100 })` logo após conectar (popula o cache de entidades antes de `getEntity()` funcionar de forma confiável numa sessão "fria").
- `teleproto`'s `sendFile` aceita uma URL string diretamente no campo `file` (confirmado lendo `node_modules/teleproto/define.d.ts`: `FileLike` inclui `ExternalUrl = string`) — **não precisa baixar a imagem antes**, só passar `product.imageUrl` direto.
- Falha ao enviar pra um grupo específico não interrompe os demais — capturada por grupo, cada um reportado individualmente.
- Sem teste automatizado pro envio real via GramJS (a função de produção `postToTelegramGroups`) — mesma limitação já aceita hoje pro poller (`fetchNewMessages`/`getLatestMessageId` em `telegram-poll/route.ts` também não têm teste automatizado, só a lógica pura em `poller.ts` tem). Só a lógica pura injetável (`sendToTelegramGroups`) é testada.
- Tipos exatos (ver Task 1 — usados por Task 2):
  ```typescript
  export interface TelegramGroupSendResult {
    groupId: string;
    ok: boolean;
    error?: string;
  }

  export interface TelegramGroupsResult {
    ok: boolean;
    results: TelegramGroupSendResult[];
    error?: string; // erro de conexão (sessão/credenciais/connect) — não chegou nem a tentar os grupos
  }
  ```

---

### Task 1: Módulo de envio pra grupos do Telegram

**Files:**
- Create: `src/lib/social/telegramGroups.ts`
- Create: `src/lib/social/telegramGroups.test.ts`

**Interfaces:**
- Consumes: `loadSession(): Promise<string>` de `src/lib/telegram/sessionStore.ts` (já existe, sem mudança).
- Produces (usado pela Task 2): `export async function postToTelegramGroups(imageUrl: string, caption: string): Promise<TelegramGroupsResult>` — lê `TELEGRAM_TARGET_GROUP_IDS` do ambiente, conecta, envia, desconecta.
- Produces (tipos usados pela Task 2): `TelegramGroupSendResult`, `TelegramGroupsResult` (definidos acima em Global Constraints).

- [ ] **Step 1: Write the failing tests for the pure orchestrator**

Crie `src/lib/social/telegramGroups.test.ts`:

```typescript
// src/lib/social/telegramGroups.test.ts
import { describe, expect, it, vi } from 'vitest';
import { sendToTelegramGroups } from './telegramGroups';

describe('sendToTelegramGroups', () => {
  it('reporta sucesso em todos os grupos quando todos os envios funcionam', async () => {
    const sendPhotoToGroup = vi.fn().mockResolvedValue(undefined);

    const result = await sendToTelegramGroups(
      ['-100111', '-100222'],
      'https://x.com/img.jpg',
      'legenda',
      { sendPhotoToGroup },
    );

    expect(result).toEqual({
      ok: true,
      results: [
        { groupId: '-100111', ok: true },
        { groupId: '-100222', ok: true },
      ],
    });
    expect(sendPhotoToGroup).toHaveBeenCalledWith('-100111', 'https://x.com/img.jpg', 'legenda');
    expect(sendPhotoToGroup).toHaveBeenCalledWith('-100222', 'https://x.com/img.jpg', 'legenda');
  });

  it('continua tentando os outros grupos quando um grupo falha (sucesso parcial)', async () => {
    const sendPhotoToGroup = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('bot removido do grupo'));

    const result = await sendToTelegramGroups(
      ['-100111', '-100222'],
      'https://x.com/img.jpg',
      'legenda',
      { sendPhotoToGroup },
    );

    expect(result).toEqual({
      ok: true,
      results: [
        { groupId: '-100111', ok: true },
        { groupId: '-100222', ok: false, error: 'bot removido do grupo' },
      ],
    });
  });

  it('reporta ok:false quando todos os grupos falham', async () => {
    const sendPhotoToGroup = vi.fn().mockRejectedValue(new Error('grupo inválido'));

    const result = await sendToTelegramGroups(['-100111'], 'https://x.com/img.jpg', 'legenda', {
      sendPhotoToGroup,
    });

    expect(result).toEqual({
      ok: false,
      results: [{ groupId: '-100111', ok: false, error: 'grupo inválido' }],
    });
  });

  it('retorna resultado vazio quando a lista de grupos está vazia', async () => {
    const sendPhotoToGroup = vi.fn();

    const result = await sendToTelegramGroups([], 'https://x.com/img.jpg', 'legenda', {
      sendPhotoToGroup,
    });

    expect(result).toEqual({ ok: false, results: [] });
    expect(sendPhotoToGroup).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/social/telegramGroups.test.ts`
Expected: FAIL — `Failed to resolve import "./telegramGroups"` (o arquivo ainda não existe).

- [ ] **Step 3: Write the pure orchestrator implementation**

Crie `src/lib/social/telegramGroups.ts` com a primeira parte (o orquestrador puro):

```typescript
// src/lib/social/telegramGroups.ts
export interface TelegramGroupSendResult {
  groupId: string;
  ok: boolean;
  error?: string;
}

export interface TelegramGroupsResult {
  ok: boolean;
  results: TelegramGroupSendResult[];
  error?: string;
}

export interface TelegramGroupsDeps {
  sendPhotoToGroup: (groupId: string, imageUrl: string, caption: string) => Promise<void>;
}

export async function sendToTelegramGroups(
  groupIds: string[],
  imageUrl: string,
  caption: string,
  deps: TelegramGroupsDeps,
): Promise<TelegramGroupsResult> {
  const results: TelegramGroupSendResult[] = [];

  for (const groupId of groupIds) {
    try {
      await deps.sendPhotoToGroup(groupId, imageUrl, caption);
      results.push({ groupId, ok: true });
    } catch (err) {
      results.push({ groupId, ok: false, error: (err as Error).message });
    }
  }

  return { ok: results.some((r) => r.ok), results };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/social/telegramGroups.test.ts`
Expected: PASS (4/4 testes).

- [ ] **Step 5: Add the production wiring (no test — matches existing GramJS precedent)**

Adicione ao final de `src/lib/social/telegramGroups.ts` (mantendo tudo do Step 3 intacto):

```typescript
// src/lib/social/telegramGroups.ts (adicionar ao final do arquivo)
import { TelegramClient } from 'teleproto';
import { StringSession } from 'teleproto/sessions/index.js';
import { loadSession } from '../telegram/sessionStore';

function readGroupIds(): string[] {
  const raw = process.env.TELEGRAM_TARGET_GROUP_IDS;
  if (!raw) return [];
  return raw
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean);
}

function readTelegramCredentials(): { apiId: number; apiHash: string } {
  const apiId = Number(process.env.TELEGRAM_API_ID);
  const apiHash = process.env.TELEGRAM_API_HASH;
  if (!apiId || !apiHash) {
    throw new Error('Variáveis de ambiente do Telegram ausentes: TELEGRAM_API_ID, TELEGRAM_API_HASH');
  }
  return { apiId, apiHash };
}

// Sem teste automatizado — mesma limitação já aceita pro resto da
// integração GramJS do projeto (fetchNewMessages/getLatestMessageId em
// src/app/api/telegram-poll/route.ts também não têm teste automatizado).
// A lógica testável fica isolada em sendToTelegramGroups, acima.
export async function postToTelegramGroups(imageUrl: string, caption: string): Promise<TelegramGroupsResult> {
  const groupIds = readGroupIds();
  if (groupIds.length === 0) {
    return { ok: false, results: [] };
  }

  let client: TelegramClient;
  try {
    const { apiId, apiHash } = readTelegramCredentials();
    const sessionString = await loadSession();
    client = new TelegramClient(new StringSession(sessionString), apiId, apiHash, {
      connectionRetries: 3,
    });
    await client.connect();
    // StringSession.save() não persiste o cache de entidades/accessHash —
    // getDialogs() popula esse cache antes do getEntity() funcionar de
    // forma confiável, mesmo padrão já usado em telegram-poll/route.ts.
    await client.getDialogs({ limit: 100 });
  } catch (err) {
    console.error('Erro ao conectar no Telegram pra disparar pros grupos:', err);
    return { ok: false, results: [], error: (err as Error).message };
  }

  try {
    const sendPhotoToGroup = async (groupId: string, url: string, cap: string): Promise<void> => {
      const entity = await client.getEntity(groupId);
      await client.sendFile(entity, { file: url, caption: cap });
    };
    return await sendToTelegramGroups(groupIds, imageUrl, caption, { sendPhotoToGroup });
  } finally {
    await client.disconnect();
  }
}
```

- [ ] **Step 6: Run the full test suite to confirm nothing broke**

Run: `npx vitest run`
Expected: todos os testes passando, incluindo os 4 novos de `telegramGroups.test.ts`.

- [ ] **Step 7: Run typecheck**

Run: `npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 8: Commit**

```bash
git add src/lib/social/telegramGroups.ts src/lib/social/telegramGroups.test.ts
git commit -m "feat: modulo de envio de promocao pra grupos do Telegram"
```

---

### Task 2: Integrar no webhook e documentar a env var

**Files:**
- Modify: `src/app/api/webhook/route.ts`
- Modify: `src/app/api/webhook/route.test.ts`
- Modify: `.env.example`

**Interfaces:**
- Consumes (da Task 1): `postToTelegramGroups(imageUrl: string, caption: string): Promise<TelegramGroupsResult>`, tipo `TelegramGroupsResult` de `src/lib/social/telegramGroups.ts`.

- [ ] **Step 1: Write the failing test for the webhook's telegram field**

Em `src/app/api/webhook/route.test.ts`, adicione o mock no topo do arquivo (junto aos `vi.mock` já existentes):

```typescript
// src/app/api/webhook/route.test.ts (adicionar junto aos vi.mock já existentes, no topo)
vi.mock('@/lib/social/telegramGroups', () => ({ postToTelegramGroups: vi.fn() }));
```

E o import (junto aos imports já existentes):

```typescript
// src/app/api/webhook/route.test.ts (adicionar junto aos imports já existentes)
import { postToTelegramGroups } from '@/lib/social/telegramGroups';
```

Depois, no teste `'retorna 200 com a url do post no caminho feliz, e posta no Facebook, Instagram, Story e TikTok'`, adicione o mock do Telegram junto aos outros mocks de sucesso (antes do `const response = await POST(...)`):

```typescript
// dentro do teste do caminho feliz, junto aos outros vi.mocked(...).mockResolvedValue(...)
vi.mocked(postToTelegramGroups).mockResolvedValue({
  ok: true,
  results: [{ groupId: '-100111', ok: true }],
});
```

E troque o `expect(json).toEqual({...})` desse mesmo teste pra incluir o campo `telegram`:

```typescript
expect(json).toEqual({
  postUrl: 'https://loja.myshopify.com/blogs/noticias/produto-x',
  facebook: { ok: true, postId: 'fb-1' },
  instagram: { ok: true, postId: 'ig-1' },
  story: { ok: true, postId: 'story-1' },
  tiktok: { ok: true, postId: 'tt-1' },
  telegram: { ok: true, results: [{ groupId: '-100111', ok: true }] },
});
```

E adicione a asserção de chamada, junto às outras `expect(postToX).toHaveBeenCalledWith(...)` já existentes nesse teste:

```typescript
expect(postToTelegramGroups).toHaveBeenCalledWith('https://x.com/img.jpg', 'legenda social');
```

No teste `'retorna postUrl mesmo quando Facebook, Instagram, Story e TikTok falham (best-effort, não derruba o blog)'`, adicione o mock de falha junto aos outros `mockRejectedValue`:

```typescript
vi.mocked(postToTelegramGroups).mockRejectedValue(new Error('Sessão do Telegram expirada'));
```

E no `expect(json).toEqual({...})` desse teste, adicione:

```typescript
telegram: { ok: false, results: [] },
```

(O título do teste continua descrevendo Facebook/Instagram/Story/TikTok — não precisa mudar o nome do teste nesta task, só o corpo, pra manter o diff pequeno.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/app/api/webhook/route.test.ts`
Expected: FAIL — `telegram` ausente no JSON retornado (o branch ainda não existe em `route.ts`), e o import de `@/lib/social/telegramGroups` falha por o arquivo/export não ser usado ainda no route (isso é esperado, é só o teste que já referencia o mock).

- [ ] **Step 3: Wire the Telegram branch into the webhook**

Em `src/app/api/webhook/route.ts`, adicione o import (junto aos imports já existentes):

```typescript
import { postToTelegramGroups } from '@/lib/social/telegramGroups';
import type { TelegramGroupsResult } from '@/lib/social/telegramGroups';
```

Adicione a função de gate (junto a `isMetaConfigured`/`isTikTokConfigured`):

```typescript
function isTelegramGroupsConfigured(): boolean {
  return Boolean(process.env.TELEGRAM_TARGET_GROUP_IDS);
}
```

Troque a condição que decide se monta a legenda (linha com `if (isMetaConfigured() || isTikTokConfigured())`) pra incluir o Telegram:

```typescript
  if (isMetaConfigured() || isTikTokConfigured() || isTelegramGroupsConfigured()) {
```

Adicione o `telegramPromise` (junto a `facebookPromise`/`instagramPromise`/`tiktokPromise`, antes do `Promise.all`):

```typescript
  const telegramPromise: Promise<TelegramGroupsResult> = (async () => {
    if (!isTelegramGroupsConfigured()) return { ok: false, results: [] };
    if (captionError) return { ok: false, results: [] };
    return postToTelegramGroups(product.imageUrl, caption as string);
  })();
```

Troque o `Promise.all` e o `return` de `postToSocialNetworks` pra incluir o Telegram:

```typescript
  const [facebook, instagram, story, tiktok, telegram] = await Promise.all([
    facebookPromise,
    instagramPromise,
    storyResultPromise,
    tiktokPromise,
    telegramPromise,
  ]);

  return { facebook, instagram, story, tiktok, telegram };
```

E a assinatura de retorno de `postToSocialNetworks` (linha `): Promise<{ facebook: SocialResult; instagram: SocialResult; story: SocialResult; tiktok: SocialResult }> {`) precisa ganhar o campo novo:

```typescript
): Promise<{
  facebook: SocialResult;
  instagram: SocialResult;
  story: SocialResult;
  tiktok: SocialResult;
  telegram: TelegramGroupsResult;
}> {
```

Por fim, o `POST` handler já desestrutura `{ facebook, instagram, story, tiktok }` do retorno de `postToSocialNetworks` e monta a resposta JSON — troque as duas ocorrências pra incluir `telegram`:

```typescript
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/app/api/webhook/route.test.ts`
Expected: PASS.

- [ ] **Step 5: Run the full test suite**

Run: `npx vitest run`
Expected: todos os testes passando.

- [ ] **Step 6: Run typecheck**

Run: `npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 7: Document the new env var**

Em `.env.example`, adicione logo depois da linha `TELEGRAM_TARGET_CHAT_ID=` (mantendo a linha em branco depois, antes do bloco do `CRON_SECRET`):

```
# ID do chat (grupo/canal) do Telegram a monitorar — listado pelo script de bootstrap
TELEGRAM_TARGET_CHAT_ID=

# Lista de IDs de grupo do Telegram (separados por vírgula) pra onde cada
# promoção publicada também é disparada como foto+legenda — além do canal
# de origem acima. Reaproveita a mesma sessão/conta, sem credencial nova.
# Vazio = recurso desligado (nenhum disparo, sem erro). Ex: -100111,-100222
TELEGRAM_TARGET_GROUP_IDS=

# Segredo que a Vercel envia automaticamente pro endpoint de cron (Project Settings > Cron Jobs)
CRON_SECRET=
```

- [ ] **Step 8: Commit**

```bash
git add src/app/api/webhook/route.ts src/app/api/webhook/route.test.ts .env.example
git commit -m "feat: webhook dispara promocao tambem pros grupos do Telegram configurados"
```
