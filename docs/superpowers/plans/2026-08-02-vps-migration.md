# Migração PromoPost pra VPS Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Trocar Vercel Sandbox (Playwright) e Vercel Blob (storage) por execução local e disco local, e empacotar a aplicação num container Docker pronta pra rodar num VPS — sem alterar nenhum comportamento observável do pipeline (mesmas rotas, mesmos códigos de erro, mesmo formato de entrada/saída).

**Architecture:** 5 módulos de storage (`cursorStore`, `tiktokTokenStore`, `lock`, 2× `sessionStore`) passam a ler/escrever em arquivos sob um diretório fixo (`DATA_DIR`, default `/data`) através de um módulo compartilhado `localStore.ts`, em vez de falar com `@vercel/blob`. `affiliateLink.ts` passa a rodar o script Playwright (`generate-link.playwright.mjs`) como um subprocesso local (`child_process.execFile`) em vez de criar uma Vercel Sandbox remota — o script recebe o caminho da sessão via variável de ambiente em vez de um arquivo escrito pela API de Sandbox. Um `Dockerfile` empacota tudo (Node + Chromium instalado na build, não por execução) e um `docker-compose.yml` sobe o serviço com o volume de dados montado.

**Tech Stack:** Node.js 24, TypeScript, Next.js (App Router), Playwright, Vitest, Docker.

## Global Constraints

- Node.js >= 24 (já fixado em `package.json` → `engines.node`).
- `DATA_DIR` é o diretório raiz de todo dado persistido localmente (sessões, cursor, tokens, lock); default `/data` quando a variável não está definida.
- Sem CI/CD automatizado — deploy continua manual via SSH (`git pull && docker compose up -d --build`), mesmo espírito do `vercel deploy --prod` manual de hoje.
- Sem storage externo (S3 ou equivalente) — só disco local do VPS.
- Nenhuma mudança de lógica de negócio, regras de extração, templates de post ou formato de entrada/saída de rota — migração é só de infraestrutura.
- Chromium é instalado **uma vez, na build da imagem Docker** — nunca por execução/chamada.
- Os códigos de erro emitidos pelo script Playwright não mudam: `SESSION_EXPIRED`, `PRODUCT_NOT_FOUND`, `MARKETPLACE_NOT_SUPPORTED`, `PRODUCT_LIST_LINK`, `SHOPEE_CREDENTIALS_MISSING`, `SHOPEE_API_ERROR`.

---

### Task 1: Módulo de storage local (`localStore.ts`)

**Files:**
- Create: `src/lib/storage/localStore.ts`
- Test: `src/lib/storage/localStore.test.ts`

**Interfaces:**
- Produces (usado por todas as tasks seguintes):
  - `resolveDataPath(filename: string): string`
  - `readJsonFile<T>(filename: string): Promise<T | null>`
  - `writeJsonFile(filename: string, data: unknown): Promise<void>`
  - `readTextFile(filename: string): Promise<string | null>` (conteúdo já `.trim()`)
  - `writeTextFile(filename: string, content: string): Promise<void>`
  - `readBufferFile(filename: string): Promise<Buffer | null>`
  - `fileAgeMs(filename: string): Promise<number | null>` (idade do arquivo em ms desde a última escrita, `null` se não existe)
  - `deleteFile(filename: string): Promise<void>` (não lança se o arquivo não existir)

- [ ] **Step 1: Write the failing tests**

```typescript
// src/lib/storage/localStore.test.ts
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let dataDir: string;

beforeEach(async () => {
  dataDir = await mkdtemp(path.join(tmpdir(), 'promopost-localstore-test-'));
  vi.stubEnv('DATA_DIR', dataDir);
});

afterEach(async () => {
  vi.unstubAllEnvs();
  vi.resetModules();
  await rm(dataDir, { recursive: true, force: true });
});

describe('resolveDataPath', () => {
  it('junta o DATA_DIR configurado com o nome do arquivo', async () => {
    const { resolveDataPath } = await import('./localStore');
    expect(resolveDataPath('foo.json')).toBe(path.join(dataDir, 'foo.json'));
  });
});

describe('readJsonFile / writeJsonFile', () => {
  it('retorna null quando o arquivo não existe', async () => {
    const { readJsonFile } = await import('./localStore');
    const data = await readJsonFile('missing.json');
    expect(data).toBeNull();
  });

  it('escreve e lê de volta o mesmo JSON, criando o diretório se preciso', async () => {
    const nestedDir = path.join(dataDir, 'nested');
    vi.stubEnv('DATA_DIR', nestedDir);
    const { readJsonFile, writeJsonFile } = await import('./localStore');

    await writeJsonFile('foo.json', { a: 1 });
    const data = await readJsonFile<{ a: number }>('foo.json');

    expect(data).toEqual({ a: 1 });
  });
});

describe('readTextFile / writeTextFile', () => {
  it('retorna null quando o arquivo não existe', async () => {
    const { readTextFile } = await import('./localStore');
    expect(await readTextFile('missing.txt')).toBeNull();
  });

  it('escreve e lê de volta o texto, sem espaços nas pontas', async () => {
    const { readTextFile, writeTextFile } = await import('./localStore');
    await writeTextFile('foo.txt', '  conteudo  \n');
    expect(await readTextFile('foo.txt')).toBe('conteudo');
  });
});

describe('readBufferFile', () => {
  it('retorna null quando o arquivo não existe', async () => {
    const { readBufferFile } = await import('./localStore');
    expect(await readBufferFile('missing.bin')).toBeNull();
  });

  it('retorna o conteúdo como Buffer', async () => {
    const { readBufferFile, writeJsonFile } = await import('./localStore');
    await writeJsonFile('foo.json', { a: 1 });
    const buffer = await readBufferFile('foo.json');
    expect(buffer?.toString()).toBe(JSON.stringify({ a: 1 }));
  });
});

describe('fileAgeMs', () => {
  it('retorna null quando o arquivo não existe', async () => {
    const { fileAgeMs } = await import('./localStore');
    expect(await fileAgeMs('missing.lock')).toBeNull();
  });

  it('retorna a idade em ms de um arquivo recém-escrito, próxima de zero', async () => {
    const { fileAgeMs, writeTextFile } = await import('./localStore');
    await writeTextFile('foo.lock', String(Date.now()));
    const age = await fileAgeMs('foo.lock');
    expect(age).not.toBeNull();
    expect(age as number).toBeGreaterThanOrEqual(0);
    expect(age as number).toBeLessThan(2000);
  });
});

describe('deleteFile', () => {
  it('apaga um arquivo existente', async () => {
    const { deleteFile, readTextFile, writeTextFile } = await import('./localStore');
    await writeTextFile('foo.txt', 'x');
    await deleteFile('foo.txt');
    expect(await readTextFile('foo.txt')).toBeNull();
  });

  it('não lança erro quando o arquivo não existe', async () => {
    const { deleteFile } = await import('./localStore');
    await expect(deleteFile('missing.txt')).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/storage/localStore.test.ts`
Expected: FAIL with "Cannot find module './localStore'" (arquivo ainda não existe)

- [ ] **Step 3: Write the implementation**

```typescript
// src/lib/storage/localStore.ts
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

function dataDir(): string {
  return process.env.DATA_DIR || '/data';
}

export function resolveDataPath(filename: string): string {
  return path.join(dataDir(), filename);
}

function isEnoent(err: unknown): boolean {
  return (err as NodeJS.ErrnoException)?.code === 'ENOENT';
}

export async function readJsonFile<T>(filename: string): Promise<T | null> {
  try {
    const raw = await readFile(resolveDataPath(filename), 'utf8');
    return JSON.parse(raw) as T;
  } catch (err) {
    if (isEnoent(err)) return null;
    throw err;
  }
}

export async function writeJsonFile(filename: string, data: unknown): Promise<void> {
  await mkdir(dataDir(), { recursive: true });
  await writeFile(resolveDataPath(filename), JSON.stringify(data), 'utf8');
}

export async function readTextFile(filename: string): Promise<string | null> {
  try {
    const raw = await readFile(resolveDataPath(filename), 'utf8');
    return raw.trim();
  } catch (err) {
    if (isEnoent(err)) return null;
    throw err;
  }
}

export async function writeTextFile(filename: string, content: string): Promise<void> {
  await mkdir(dataDir(), { recursive: true });
  await writeFile(resolveDataPath(filename), content, 'utf8');
}

export async function readBufferFile(filename: string): Promise<Buffer | null> {
  try {
    return await readFile(resolveDataPath(filename));
  } catch (err) {
    if (isEnoent(err)) return null;
    throw err;
  }
}

export async function fileAgeMs(filename: string): Promise<number | null> {
  try {
    const info = await stat(resolveDataPath(filename));
    return Date.now() - info.mtimeMs;
  } catch (err) {
    if (isEnoent(err)) return null;
    throw err;
  }
}

export async function deleteFile(filename: string): Promise<void> {
  await rm(resolveDataPath(filename), { force: true });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/storage/localStore.test.ts`
Expected: PASS (todos os testes)

- [ ] **Step 5: Commit**

```bash
git add src/lib/storage/localStore.ts src/lib/storage/localStore.test.ts
git commit -m "feat: adiciona módulo de storage local em disco (DATA_DIR)"
```

---

### Task 2: Migrar `cursorStore.ts` pra storage local

**Files:**
- Modify: `src/lib/telegram/cursorStore.ts`
- Modify: `src/lib/telegram/cursorStore.test.ts`

**Interfaces:**
- Consumes: `readJsonFile`, `writeJsonFile` de `../storage/localStore` (Task 1).
- Produces: `loadCursor(): Promise<number | null>`, `saveCursor(messageId: number): Promise<void>` — assinaturas inalteradas, usadas por `src/app/api/telegram-poll/route.ts` e `src/lib/telegram/poller.ts` sem nenhuma mudança nesses arquivos.

- [ ] **Step 1: Write the failing tests**

```typescript
// src/lib/telegram/cursorStore.test.ts
import { afterEach, describe, expect, it, vi } from 'vitest';

const { readJsonFileMock, writeJsonFileMock } = vi.hoisted(() => ({
  readJsonFileMock: vi.fn(),
  writeJsonFileMock: vi.fn(),
}));

vi.mock('../storage/localStore', () => ({
  readJsonFile: readJsonFileMock,
  writeJsonFile: writeJsonFileMock,
}));

import { loadCursor, saveCursor } from './cursorStore';

describe('loadCursor', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('retorna null quando não existe cursor salvo ainda', async () => {
    readJsonFileMock.mockResolvedValue(null);

    const cursor = await loadCursor();

    expect(cursor).toBeNull();
    expect(readJsonFileMock).toHaveBeenCalledWith('telegram-cursor.json');
  });

  it('retorna o lastMessageId do cursor salvo', async () => {
    readJsonFileMock.mockResolvedValue({ lastMessageId: 4242 });

    const cursor = await loadCursor();

    expect(cursor).toBe(4242);
  });

  it('lança erro em português quando a leitura falha', async () => {
    readJsonFileMock.mockRejectedValue(new Error('disk error'));

    await expect(loadCursor()).rejects.toThrow('Falha ao carregar cursor do Telegram: disk error');
  });
});

describe('saveCursor', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('grava o lastMessageId no arquivo fixo', async () => {
    writeJsonFileMock.mockResolvedValue(undefined);

    await saveCursor(4242);

    expect(writeJsonFileMock).toHaveBeenCalledWith('telegram-cursor.json', { lastMessageId: 4242 });
  });

  it('lança erro em português quando a escrita falha', async () => {
    writeJsonFileMock.mockRejectedValue(new Error('disk full'));

    await expect(saveCursor(4242)).rejects.toThrow('Falha ao salvar cursor do Telegram: disk full');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/telegram/cursorStore.test.ts`
Expected: FAIL (implementação atual ainda usa `@vercel/blob`, `readJsonFileMock`/`writeJsonFileMock` nunca são chamados)

- [ ] **Step 3: Write the implementation**

```typescript
// src/lib/telegram/cursorStore.ts
import { readJsonFile, writeJsonFile } from '../storage/localStore';

const CURSOR_FILENAME = 'telegram-cursor.json';

export async function loadCursor(): Promise<number | null> {
  let data: { lastMessageId?: number } | null;
  try {
    data = await readJsonFile<{ lastMessageId?: number }>(CURSOR_FILENAME);
  } catch (err) {
    throw new Error(`Falha ao carregar cursor do Telegram: ${(err as Error).message}`);
  }
  return typeof data?.lastMessageId === 'number' ? data.lastMessageId : null;
}

export async function saveCursor(messageId: number): Promise<void> {
  try {
    await writeJsonFile(CURSOR_FILENAME, { lastMessageId: messageId });
  } catch (err) {
    throw new Error(`Falha ao salvar cursor do Telegram: ${(err as Error).message}`);
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/telegram/cursorStore.test.ts`
Expected: PASS (todos os testes)

- [ ] **Step 5: Commit**

```bash
git add src/lib/telegram/cursorStore.ts src/lib/telegram/cursorStore.test.ts
git commit -m "refactor: cursorStore usa storage local em vez de Vercel Blob"
```

---

### Task 3: Migrar `tiktokTokenStore.ts` (load/save) pra storage local

**Files:**
- Modify: `src/lib/social/tiktokTokenStore.ts`
- Modify: `src/lib/social/tiktokTokenStore.test.ts`

**Interfaces:**
- Consumes: `readJsonFile`, `writeJsonFile` de `../storage/localStore` (Task 1).
- Produces: `loadTikTokTokens(): Promise<TikTokTokens | null>`, `saveTikTokTokens(tokens: TikTokTokens): Promise<void>` — assinaturas e `interface TikTokTokens` inalteradas. `exchangeTikTokToken` **não muda** (não toca storage, só faz `fetch` na API do TikTok) — mantenha exatamente como está hoje no arquivo.

- [ ] **Step 1: Write the failing tests**

Substitua só os blocos `describe('loadTikTokTokens', ...)` e `describe('saveTikTokTokens', ...)` do arquivo de teste atual — o bloco `describe('exchangeTikTokToken', ...)` (já existente no arquivo) **fica intacto, sem mudança**. Resultado final do topo do arquivo até o fim de `saveTikTokTokens`:

```typescript
// src/lib/social/tiktokTokenStore.test.ts (topo do arquivo até o fim de saveTikTokTokens)
import { afterEach, describe, expect, it, vi } from 'vitest';

const { readJsonFileMock, writeJsonFileMock } = vi.hoisted(() => ({
  readJsonFileMock: vi.fn(),
  writeJsonFileMock: vi.fn(),
}));

vi.mock('../storage/localStore', () => ({
  readJsonFile: readJsonFileMock,
  writeJsonFile: writeJsonFileMock,
}));

import { exchangeTikTokToken, loadTikTokTokens, saveTikTokTokens } from './tiktokTokenStore';

describe('loadTikTokTokens', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('retorna null quando não existe token salvo ainda', async () => {
    readJsonFileMock.mockResolvedValue(null);

    const tokens = await loadTikTokTokens();

    expect(tokens).toBeNull();
    expect(readJsonFileMock).toHaveBeenCalledWith('tiktok-tokens.json');
  });

  it('retorna o token salvo', async () => {
    readJsonFileMock.mockResolvedValue({ accessToken: 'act123', refreshToken: 'rft456', expiresAt: 1234567890 });

    const tokens = await loadTikTokTokens();

    expect(tokens).toEqual({ accessToken: 'act123', refreshToken: 'rft456', expiresAt: 1234567890 });
  });

  it('lança erro em português quando a leitura falha', async () => {
    readJsonFileMock.mockRejectedValue(new Error('disk error'));

    await expect(loadTikTokTokens()).rejects.toThrow('Falha ao carregar token do TikTok: disk error');
  });
});

describe('saveTikTokTokens', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('grava o token no arquivo fixo', async () => {
    writeJsonFileMock.mockResolvedValue(undefined);

    await saveTikTokTokens({ accessToken: 'act123', refreshToken: 'rft456', expiresAt: 1234567890 });

    expect(writeJsonFileMock).toHaveBeenCalledWith('tiktok-tokens.json', {
      accessToken: 'act123',
      refreshToken: 'rft456',
      expiresAt: 1234567890,
    });
  });

  it('lança erro em português quando a escrita falha', async () => {
    writeJsonFileMock.mockRejectedValue(new Error('disk full'));

    await expect(
      saveTikTokTokens({ accessToken: 'act123', refreshToken: 'rft456', expiresAt: 1234567890 }),
    ).rejects.toThrow('Falha ao salvar token do TikTok: disk full');
  });
});

// describe('exchangeTikTokToken', ...) — mantém exatamente o que já existe no arquivo hoje, sem mudança.
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/social/tiktokTokenStore.test.ts`
Expected: FAIL (implementação atual ainda usa `@vercel/blob`)

- [ ] **Step 3: Write the implementation**

Substitua só `loadTikTokTokens` e `saveTikTokTokens` no arquivo — `exchangeTikTokToken` e a `interface TikTokTokens` ficam exatamente como estão hoje:

```typescript
// src/lib/social/tiktokTokenStore.ts (topo do arquivo)
import { readJsonFile, writeJsonFile } from '../storage/localStore';

const TOKENS_FILENAME = 'tiktok-tokens.json';

export interface TikTokTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}

export async function loadTikTokTokens(): Promise<TikTokTokens | null> {
  try {
    return await readJsonFile<TikTokTokens>(TOKENS_FILENAME);
  } catch (err) {
    throw new Error(`Falha ao carregar token do TikTok: ${(err as Error).message}`);
  }
}

// exchangeTikTokToken(params) — mantém exatamente igual ao arquivo atual, sem mudança.

export async function saveTikTokTokens(tokens: TikTokTokens): Promise<void> {
  try {
    await writeJsonFile(TOKENS_FILENAME, tokens);
  } catch (err) {
    throw new Error(`Falha ao salvar token do TikTok: ${(err as Error).message}`);
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/social/tiktokTokenStore.test.ts`
Expected: PASS (todos os testes, incluindo os de `exchangeTikTokToken` que não mudaram)

- [ ] **Step 5: Commit**

```bash
git add src/lib/social/tiktokTokenStore.ts src/lib/social/tiktokTokenStore.test.ts
git commit -m "refactor: tiktokTokenStore usa storage local em vez de Vercel Blob"
```

---

### Task 4: Migrar `lock.ts` pra storage local

**Files:**
- Modify: `src/lib/telegram/lock.ts`
- Modify: `src/lib/telegram/lock.test.ts`

**Interfaces:**
- Consumes: `fileAgeMs`, `writeTextFile`, `deleteFile` de `../storage/localStore` (Task 1).
- Produces: `acquireLock(): Promise<boolean>`, `releaseLock(): Promise<void>` — assinaturas inalteradas, usadas por `src/app/api/telegram-poll/route.ts` sem mudança.

- [ ] **Step 1: Write the failing tests**

```typescript
// src/lib/telegram/lock.test.ts
import { afterEach, describe, expect, it, vi } from 'vitest';

const { fileAgeMsMock, writeTextFileMock, deleteFileMock } = vi.hoisted(() => ({
  fileAgeMsMock: vi.fn(),
  writeTextFileMock: vi.fn(),
  deleteFileMock: vi.fn(),
}));

vi.mock('../storage/localStore', () => ({
  fileAgeMs: fileAgeMsMock,
  writeTextFile: writeTextFileMock,
  deleteFile: deleteFileMock,
}));

import { acquireLock, releaseLock } from './lock';

describe('acquireLock', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('trava quando não existe lock nenhum ainda', async () => {
    fileAgeMsMock.mockResolvedValue(null);
    writeTextFileMock.mockResolvedValue(undefined);

    const locked = await acquireLock();

    expect(locked).toBe(true);
    expect(writeTextFileMock).toHaveBeenCalledWith('telegram-poll.lock', expect.any(String));
  });

  it('recusa travar quando já existe um lock recente de outra execução', async () => {
    fileAgeMsMock.mockResolvedValue(10_000);

    const locked = await acquireLock();

    expect(locked).toBe(false);
    expect(writeTextFileMock).not.toHaveBeenCalled();
  });

  it('trava mesmo assim quando o lock existente está velho (execução anterior travou/morreu)', async () => {
    fileAgeMsMock.mockResolvedValue(10 * 60 * 1000);
    writeTextFileMock.mockResolvedValue(undefined);

    const locked = await acquireLock();

    expect(locked).toBe(true);
    expect(writeTextFileMock).toHaveBeenCalled();
  });
});

describe('releaseLock', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('apaga o arquivo de lock', async () => {
    deleteFileMock.mockResolvedValue(undefined);

    await releaseLock();

    expect(deleteFileMock).toHaveBeenCalledWith('telegram-poll.lock');
  });

  it('não lança erro se apagar o lock falhar', async () => {
    deleteFileMock.mockRejectedValue(new Error('disk error'));

    await expect(releaseLock()).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/telegram/lock.test.ts`
Expected: FAIL (implementação atual ainda usa `@vercel/blob`)

- [ ] **Step 3: Write the implementation**

```typescript
// src/lib/telegram/lock.ts
import { deleteFile, fileAgeMs, writeTextFile } from '../storage/localStore';

const LOCK_FILENAME = 'telegram-poll.lock';

// Mesmo teto do maxDuration da rota — um lock mais velho que isso só pode
// ser de uma execução travada/morta, não de uma execução legítima em
// andamento, então é seguro destravar.
const LOCK_STALE_MS = 5 * 60 * 1000;

/**
 * Tenta travar o poller pra evitar que duas execuções concorrentes (cron
 * sobrepondo, disparo manual coincidindo com o cron, etc.) processem o
 * mesmo lote de mensagens e publiquem posts duplicados. Retorna false se
 * já existir um lock válido (não expirado) de outra execução.
 */
export async function acquireLock(): Promise<boolean> {
  const ageMs = await fileAgeMs(LOCK_FILENAME);
  if (ageMs !== null && ageMs < LOCK_STALE_MS) {
    return false;
  }

  await writeTextFile(LOCK_FILENAME, String(Date.now()));
  return true;
}

export async function releaseLock(): Promise<void> {
  await deleteFile(LOCK_FILENAME).catch(() => {});
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/telegram/lock.test.ts`
Expected: PASS (todos os testes)

- [ ] **Step 5: Commit**

```bash
git add src/lib/telegram/lock.ts src/lib/telegram/lock.test.ts
git commit -m "refactor: lock do poller usa storage local em vez de Vercel Blob"
```

---

### Task 5: Migrar `telegram/sessionStore.ts` pra storage local

**Files:**
- Modify: `src/lib/telegram/sessionStore.ts`
- Modify: `src/lib/telegram/sessionStore.test.ts`

**Interfaces:**
- Consumes: `readTextFile`, `resolveDataPath` de `../storage/localStore` (Task 1).
- Produces: `loadSession(): Promise<string>` — assinatura inalterada, usada por `src/app/api/telegram-poll/route.ts` sem mudança.

- [ ] **Step 1: Write the failing tests**

```typescript
// src/lib/telegram/sessionStore.test.ts
import { afterEach, describe, expect, it, vi } from 'vitest';

const { readTextFileMock } = vi.hoisted(() => ({
  readTextFileMock: vi.fn(),
}));

vi.mock('../storage/localStore', () => ({
  readTextFile: readTextFileMock,
  resolveDataPath: (filename: string) => `/data/${filename}`,
}));

import { loadSession } from './sessionStore';

describe('loadSession', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('lê a sessão do arquivo local, já sem espaços nas pontas', async () => {
    readTextFileMock.mockResolvedValue('1BQANOTE...sessionstring...');

    const session = await loadSession();

    expect(session).toBe('1BQANOTE...sessionstring...');
    expect(readTextFileMock).toHaveBeenCalledWith('telegram-session.txt');
  });

  it('lança erro quando o arquivo de sessão não existe', async () => {
    readTextFileMock.mockResolvedValue(null);

    await expect(loadSession()).rejects.toThrow(
      'Arquivo de sessão do Telegram não encontrado: /data/telegram-session.txt',
    );
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/telegram/sessionStore.test.ts`
Expected: FAIL (implementação atual ainda faz `fetch` numa URL do Blob)

- [ ] **Step 3: Write the implementation**

```typescript
// src/lib/telegram/sessionStore.ts
import { readTextFile, resolveDataPath } from '../storage/localStore';

const SESSION_FILENAME = 'telegram-session.txt';

export async function loadSession(): Promise<string> {
  const session = await readTextFile(SESSION_FILENAME);
  if (session === null) {
    throw new Error(`Arquivo de sessão do Telegram não encontrado: ${resolveDataPath(SESSION_FILENAME)}`);
  }
  return session;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/telegram/sessionStore.test.ts`
Expected: PASS (todos os testes)

- [ ] **Step 5: Commit**

```bash
git add src/lib/telegram/sessionStore.ts src/lib/telegram/sessionStore.test.ts
git commit -m "refactor: sessionStore do Telegram usa storage local em vez de Vercel Blob"
```

---

### Task 6: Migrar `session/sessionStore.ts` (Mercado Livre) pra storage local

**Files:**
- Modify: `src/lib/session/sessionStore.ts`
- Modify: `src/lib/session/sessionStore.test.ts`

**Interfaces:**
- Consumes: `readBufferFile`, `resolveDataPath` de `../storage/localStore` (Task 1).
- Produces: `loadSession(): Promise<Buffer>` — assinatura inalterada. Consumida por `src/lib/mercadolivre/affiliateLink.ts`, que já trata falha desta função com fallback pra `EMPTY_STORAGE_STATE` (ver Task 7) — esse comportamento de fallback não muda.

- [ ] **Step 1: Write the failing tests**

```typescript
// src/lib/session/sessionStore.test.ts
import { afterEach, describe, expect, it, vi } from 'vitest';

const { readBufferFileMock } = vi.hoisted(() => ({
  readBufferFileMock: vi.fn(),
}));

vi.mock('../storage/localStore', () => ({
  readBufferFile: readBufferFileMock,
  resolveDataPath: (filename: string) => `/data/${filename}`,
}));

import { loadSession } from './sessionStore';

describe('loadSession', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('lê a sessão do arquivo local como Buffer', async () => {
    readBufferFileMock.mockResolvedValue(Buffer.from('{"cookies":[]}'));

    const buffer = await loadSession();

    expect(buffer.toString()).toBe('{"cookies":[]}');
    expect(readBufferFileMock).toHaveBeenCalledWith('ml-session.json');
  });

  it('lança erro quando o arquivo de sessão não existe', async () => {
    readBufferFileMock.mockResolvedValue(null);

    await expect(loadSession()).rejects.toThrow(
      'Arquivo de sessão do Mercado Livre não encontrado: /data/ml-session.json',
    );
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/session/sessionStore.test.ts`
Expected: FAIL (implementação atual ainda faz `fetch` numa URL do Blob)

- [ ] **Step 3: Write the implementation**

```typescript
// src/lib/session/sessionStore.ts
import { readBufferFile, resolveDataPath } from '../storage/localStore';

const SESSION_FILENAME = 'ml-session.json';

export async function loadSession(): Promise<Buffer> {
  const buffer = await readBufferFile(SESSION_FILENAME);
  if (buffer === null) {
    throw new Error(`Arquivo de sessão do Mercado Livre não encontrado: ${resolveDataPath(SESSION_FILENAME)}`);
  }
  return buffer;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/session/sessionStore.test.ts`
Expected: PASS (todos os testes)

- [ ] **Step 5: Commit**

```bash
git add src/lib/session/sessionStore.ts src/lib/session/sessionStore.test.ts
git commit -m "refactor: sessionStore do Mercado Livre usa storage local em vez de Vercel Blob"
```

---

### Task 7: `affiliateLink.ts` roda o Playwright localmente (sem Vercel Sandbox)

**Files:**
- Modify: `src/lib/mercadolivre/affiliateLink.ts`
- Modify: `src/lib/mercadolivre/affiliateLink.test.ts`
- Modify: `src/lib/mercadolivre/generate-link.playwright.mjs:57`
- Modify: `package.json` (mover `playwright` de `devDependencies` pra `dependencies`)

**Interfaces:**
- Consumes: `loadSession(): Promise<Buffer>` de `../session/sessionStore` (Task 6, assinatura inalterada); `InvalidLinkError`, `ProductNotFoundError`, `SessionExpiredError` de `../pipeline` (inalterados); `Product` de `../marketplace/types` (inalterado).
- Produces: `fetchProductAndAffiliateLink(productLink: string): Promise<AffiliateResult>` — assinatura e formato de retorno **inalterados**, usada por `src/app/api/webhook/route.ts` sem nenhuma mudança nesse arquivo. `AffiliateResult` continua `{ product: Product, affiliateLink: string }`.

**Por que mover `playwright` pra `dependencies`:** hoje o script roda dentro da Vercel Sandbox, que instala `playwright` sozinha via `npm install playwright` no `onCreate` — o `node_modules` da aplicação principal nunca precisa dele em produção. A partir desta task o script roda como um processo filho da própria aplicação, usando o `node_modules` dela — se `playwright` continuar em `devDependencies`, qualquer instalação em modo produção (`npm ci --omit=dev`, ou a build de produção padrão) vai deixá-lo de fora e o `import { chromium } from 'playwright'` do script vai falhar com `Cannot find module 'playwright'`.

- [ ] **Step 1: Mover `playwright` pra `dependencies` em `package.json`**

Em `package.json`, remova a linha `"playwright": "^1.48.0",` de `devDependencies` e adicione `"playwright": "^1.48.0",` em `dependencies` (ordem alfabética, entre `"next"` e `"react"`):

```json
  "dependencies": {
    "@ai-sdk/groq": "^4.0.15",
    "ai": "^7.0.41",
    "input": "^1.0.1",
    "ms": "^2.1.3",
    "next": "^16.2.12",
    "playwright": "^1.48.0",
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "sharp": "^0.35.3",
    "teleproto": "^1.228.0",
    "zod": "^3.25.76"
  },
```

Repare que `@vercel/sandbox` também sai de `dependencies` nesta task (não é mais usado depois do Step 3 abaixo) — remova a linha `"@vercel/sandbox": "^2.0.0",` inteira.

- [ ] **Step 2: Rodar `npm install` pra atualizar o lockfile**

Run: `npm install`
Expected: sai limpo, `package-lock.json` atualizado refletindo a mudança de `playwright` e a remoção de `@vercel/sandbox`.

- [ ] **Step 3: Write the failing tests**

```typescript
// src/lib/mercadolivre/affiliateLink.test.ts
import { afterEach, describe, expect, it, vi } from 'vitest';

const { execFileMock } = vi.hoisted(() => ({
  execFileMock: vi.fn(),
}));

vi.mock('node:child_process', () => ({
  execFile: execFileMock,
}));

vi.mock('../session/sessionStore', () => ({
  loadSession: vi.fn().mockResolvedValue(Buffer.from('{"cookies":[]}')),
}));

import { fetchProductAndAffiliateLink } from './affiliateLink';

function mockExecFileSuccess(stdout: string) {
  execFileMock.mockImplementation((_cmd, _args, _options, callback) => {
    callback(null, stdout, '');
  });
}

function mockExecFileFailure(stderr: string) {
  execFileMock.mockImplementation((_cmd, _args, _options, callback) => {
    const err = Object.assign(new Error('Command failed'), { stderr });
    callback(err, '', stderr);
  });
}

describe('fetchProductAndAffiliateLink', () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
  });

  it('retorna produto e link de afiliado quando o script termina com sucesso', async () => {
    mockExecFileSuccess(
      `${JSON.stringify({
        title: 'Fone de Ouvido Bluetooth XYZ',
        price: 149.9,
        imageUrl: 'https://http2.mlstatic.com/img.jpg',
        marketplace: 'mercadolivre',
        affiliateLink: 'https://meli.la/abc123',
      })}\n`,
    );

    const result = await fetchProductAndAffiliateLink('https://mercadolivre.com.br/MLB123');

    expect(result).toEqual({
      product: {
        title: 'Fone de Ouvido Bluetooth XYZ',
        price: 149.9,
        imageUrl: 'https://http2.mlstatic.com/img.jpg',
        marketplace: 'mercadolivre',
      },
      affiliateLink: 'https://meli.la/abc123',
    });
    expect(execFileMock).toHaveBeenCalledWith(
      'node',
      expect.arrayContaining([expect.stringContaining('generate-link.playwright.mjs'), 'https://mercadolivre.com.br/MLB123']),
      expect.objectContaining({
        env: expect.objectContaining({ ML_SESSION_PATH: expect.any(String) }),
      }),
      expect.any(Function),
    );
  });

  it('lança SessionExpiredError quando o script reporta SESSION_EXPIRED no stderr', async () => {
    mockExecFileFailure('SESSION_EXPIRED');

    await expect(
      fetchProductAndAffiliateLink('https://mercadolivre.com.br/MLB123'),
    ).rejects.toThrow('SESSION_EXPIRED');
  });

  it('lança ProductNotFoundError quando o script reporta PRODUCT_NOT_FOUND no stderr', async () => {
    mockExecFileFailure('PRODUCT_NOT_FOUND (title=null, price=null, imageUrl=null)');

    await expect(
      fetchProductAndAffiliateLink('https://mercadolivre.com.br/MLB123'),
    ).rejects.toThrow('Produto não encontrado');
  });

  it('lança InvalidLinkError quando o script reporta MARKETPLACE_NOT_SUPPORTED no stderr', async () => {
    mockExecFileFailure('MARKETPLACE_NOT_SUPPORTED (resolvido para: https://exemplo.com/outra-coisa)');

    await expect(
      fetchProductAndAffiliateLink('https://go.promozone.ai/mercadolivre/PwQ6x6'),
    ).rejects.toThrow('Link não leva a um marketplace suportado');
  });

  it('lança InvalidLinkError (não ProductNotFoundError) quando o script reporta PRODUCT_LIST_LINK no stderr', async () => {
    mockExecFileFailure('PRODUCT_LIST_LINK (resolvido para: https://www.mercadolivre.com.br/social/promozonevip/lists)');

    await expect(
      fetchProductAndAffiliateLink('https://www.mercadolivre.com.br/social/promozonevip/lists'),
    ).rejects.toThrow('índice de listas');
  });

  it('lança erro quando o script reporta SHOPEE_CREDENTIALS_MISSING no stderr', async () => {
    mockExecFileFailure('SHOPEE_CREDENTIALS_MISSING');

    await expect(
      fetchProductAndAffiliateLink('https://shopee.com.br/produto-x'),
    ).rejects.toThrow('Variáveis de ambiente da Shopee ausentes');
  });

  it('lança erro quando o script reporta SHOPEE_API_ERROR no stderr', async () => {
    mockExecFileFailure('SHOPEE_API_ERROR ({"message":"invalid signature"})');

    await expect(
      fetchProductAndAffiliateLink('https://shopee.com.br/produto-x'),
    ).rejects.toThrow('Falha ao gerar link de afiliado da Shopee');
  });

  it('lança erro genérico quando o script falha por outro motivo', async () => {
    mockExecFileFailure('TimeoutError: locator not found');

    await expect(
      fetchProductAndAffiliateLink('https://mercadolivre.com.br/MLB123'),
    ).rejects.toThrow('Falha ao gerar link de afiliado');
  });

  it('lança erro quando a saída não é um JSON válido', async () => {
    mockExecFileSuccess('not json');

    await expect(
      fetchProductAndAffiliateLink('https://mercadolivre.com.br/MLB123'),
    ).rejects.toThrow('Saída inesperada do script de afiliado');
  });

  it('retorna produto da Shopee com marketplace correto quando o script termina com sucesso', async () => {
    mockExecFileSuccess(
      `${JSON.stringify({
        title: 'Fone Bluetooth Shopee',
        price: 59.9,
        imageUrl: 'https://down-br.img.susercontent.com/img.jpg',
        marketplace: 'shopee',
        affiliateLink: 'https://s.shopee.com.br/abc123',
      })}\n`,
    );

    const result = await fetchProductAndAffiliateLink('https://shopee.com.br/produto-x');

    expect(result.product.marketplace).toBe('shopee');
  });

  it('passa SHOPEE_APP_ID e SHOPEE_SECRET_KEY como env vars pro processo filho', async () => {
    vi.stubEnv('SHOPEE_APP_ID', 'app123');
    vi.stubEnv('SHOPEE_SECRET_KEY', 'secret456');
    mockExecFileSuccess(
      `${JSON.stringify({
        title: 'Produto',
        price: 10,
        imageUrl: 'https://x.com/img.jpg',
        marketplace: 'shopee',
        affiliateLink: 'https://s.shopee.com.br/x',
      })}\n`,
    );

    await fetchProductAndAffiliateLink('https://shopee.com.br/produto-x');

    expect(execFileMock).toHaveBeenCalledWith(
      'node',
      expect.any(Array),
      expect.objectContaining({
        env: expect.objectContaining({ SHOPEE_APP_ID: 'app123', SHOPEE_SECRET_KEY: 'secret456' }),
      }),
      expect.any(Function),
    );
  });

  it('processa um link da Shopee normalmente mesmo quando loadSession (sessão do Mercado Livre) falha', async () => {
    const { loadSession } = await import('../session/sessionStore');
    vi.mocked(loadSession).mockRejectedValueOnce(new Error('Arquivo de sessão do Mercado Livre não encontrado'));

    mockExecFileSuccess(
      `${JSON.stringify({
        title: 'Fone Bluetooth Shopee',
        price: 59.9,
        imageUrl: 'https://down-br.img.susercontent.com/img.jpg',
        marketplace: 'shopee',
        affiliateLink: 'https://s.shopee.com.br/abc123',
      })}\n`,
    );

    const result = await fetchProductAndAffiliateLink('https://shopee.com.br/produto-x');

    expect(result.product.marketplace).toBe('shopee');
  });
});
```

- [ ] **Step 4: Run tests to verify they fail**

Run: `npx vitest run src/lib/mercadolivre/affiliateLink.test.ts`
Expected: FAIL (implementação atual ainda cria uma `Sandbox` via `@vercel/sandbox`, `execFileMock` nunca é chamado)

- [ ] **Step 5: Write the implementation**

```typescript
// src/lib/mercadolivre/affiliateLink.ts
import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { InvalidLinkError, ProductNotFoundError, SessionExpiredError } from '../pipeline';
import { loadSession } from '../session/sessionStore';
import type { Product } from '../marketplace/types';

export interface AffiliateResult {
  product: Product;
  affiliateLink: string;
}

const SCRIPT_PATH = fileURLToPath(new URL('./generate-link.playwright.mjs', import.meta.url));
const EMPTY_STORAGE_STATE = Buffer.from(JSON.stringify({ cookies: [], origins: [] }));
const EXEC_TIMEOUT_MS = 4 * 60 * 1000;

function runScript(
  productLink: string,
  env: NodeJS.ProcessEnv,
): Promise<{ stdout: string }> {
  return new Promise((resolve, reject) => {
    execFile(
      'node',
      [SCRIPT_PATH, productLink],
      { timeout: EXEC_TIMEOUT_MS, env },
      (err, stdout, stderr) => {
        if (err) {
          reject(Object.assign(err, { stderr: stderr ?? '' }));
          return;
        }
        resolve({ stdout: stdout ?? '' });
      },
    );
  });
}

export async function fetchProductAndAffiliateLink(productLink: string): Promise<AffiliateResult> {
  // A Shopee não usa sessão logada (a API de afiliados usa credenciais fixas
  // via env var) — carregar a sessão do Mercado Livre não pode ser um
  // pré-requisito rígido pra esse fluxo. Se a sessão do ML não estiver
  // configurada, seguimos com um storageState vazio: o fluxo Mercado Livre
  // continua falhando (com SESSION_EXPIRED, dentro do script, quando o
  // formulário do linkbuilder não aparecer) do jeito que já falhava hoje, e
  // o fluxo Shopee fica inteiramente livre dessa dependência.
  let sessionBuffer: Buffer;
  try {
    sessionBuffer = await loadSession();
  } catch (err) {
    console.warn('Falha ao carregar sessão do Mercado Livre, seguindo com storageState vazio:', err);
    sessionBuffer = EMPTY_STORAGE_STATE;
  }

  const tempDir = await mkdtemp(path.join(tmpdir(), 'promopost-ml-session-'));
  const sessionPath = path.join(tempDir, 'session.json');
  await writeFile(sessionPath, sessionBuffer);

  let stdout: string;
  try {
    const result = await runScript(productLink, {
      ...process.env,
      ML_SESSION_PATH: sessionPath,
      SHOPEE_APP_ID: process.env.SHOPEE_APP_ID ?? '',
      SHOPEE_SECRET_KEY: process.env.SHOPEE_SECRET_KEY ?? '',
    });
    stdout = result.stdout;
  } catch (err) {
    const stderr = (err as { stderr?: string }).stderr ?? (err as Error).message ?? '';
    if (stderr.includes('SESSION_EXPIRED')) {
      throw new SessionExpiredError();
    }
    if (stderr.includes('PRODUCT_NOT_FOUND')) {
      throw new ProductNotFoundError(`Produto não encontrado na página do produto: ${stderr.slice(0, 300)}`);
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
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }

  const trimmed = stdout.trim();
  let parsed: {
    title?: unknown;
    price?: unknown;
    imageUrl?: unknown;
    marketplace?: unknown;
    affiliateLink?: unknown;
  };
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    throw new Error(`Saída inesperada do script de afiliado: ${trimmed.slice(0, 200)}`);
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

  const marketplace = parsed.marketplace === 'shopee' ? 'shopee' : 'mercadolivre';

  return {
    product: { title: parsed.title, price: parsed.price, imageUrl: parsed.imageUrl, marketplace },
    affiliateLink: parsed.affiliateLink,
  };
}
```

Também troque a linha 57 de `generate-link.playwright.mjs` (leitura da sessão) — de um caminho fixo de Sandbox pra um caminho recebido via variável de ambiente:

```javascript
// src/lib/mercadolivre/generate-link.playwright.mjs:57 — troca só esta linha
const storageState = JSON.parse(readFileSync(process.env.ML_SESSION_PATH, 'utf8'));
```

E ajuste os comentários de cabeçalho do arquivo (linhas 1-2 e 27-31) que hoje descrevem a Vercel Sandbox — troque:

```javascript
// Roda como processo filho local da aplicação (node generate-link.mjs <link-produto>).
// Usa a sessão salva no caminho apontado por ML_SESSION_PATH (storageState do Playwright).
```

e

```javascript
// --no-sandbox e --disable-setuid-sandbox continuam necessários mesmo fora da
// Vercel Sandbox: sem privilégio de kernel pro sandbox interno do próprio
// Chromium (comum em containers Docker), o browser fecha sozinho logo após
// abrir ("Target page, context or browser has been closed").
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run src/lib/mercadolivre/affiliateLink.test.ts`
Expected: PASS (todos os testes)

- [ ] **Step 7: Rodar a suíte inteira e o typecheck**

Run: `npm test && npm run typecheck`
Expected: PASS — nenhum outro arquivo importa `@vercel/sandbox` ou `Sandbox`, então a remoção do pacote não deve quebrar mais nada.

- [ ] **Step 8: Commit**

```bash
git add src/lib/mercadolivre/affiliateLink.ts src/lib/mercadolivre/affiliateLink.test.ts src/lib/mercadolivre/generate-link.playwright.mjs package.json package-lock.json
git commit -m "refactor: fetchProductAndAffiliateLink roda Playwright localmente, sem Vercel Sandbox"
```

---

### Task 8: Dockerfile e docker-compose.yml

**Files:**
- Create: `Dockerfile`
- Create: `.dockerignore`
- Create: `docker-compose.yml`

**Interfaces:**
- Consumes: `DATA_DIR` (Global Constraints — a imagem seta `DATA_DIR=/data`, montado como volume pelo compose); `npm run build`/`npm start` já existentes em `package.json` (Task 7 não mudou esses scripts); `playwright` agora em `dependencies` (Task 7), necessário pra `npx playwright install --with-deps chromium` funcionar na build.
- Produces: imagem Docker buildável (`docker build .`) e serviço subível via `docker compose up`, usados no runbook de deploy (fora do escopo de tasks deste plano, documentado no spec).

- [ ] **Step 1: Criar `.dockerignore`**

```
node_modules
.next
.git
.env
.env.local
.superpowers
docs
data
*.log
```

- [ ] **Step 2: Criar `Dockerfile`**

```dockerfile
FROM node:24-slim

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

# Instala o Chromium e as dependências de sistema necessárias UMA VEZ, na
# build da imagem — não a cada execução (era esse o custo de "Snapshot
# Storage" que motivou sair da Vercel Sandbox, ver spec da migração).
RUN npx playwright install --with-deps chromium

RUN npm run build

ENV NODE_ENV=production
ENV DATA_DIR=/data
EXPOSE 3000

CMD ["npm", "start"]
```

- [ ] **Step 3: Criar `docker-compose.yml`**

```yaml
services:
  app:
    build: .
    restart: unless-stopped
    env_file:
      - .env
    environment:
      - DATA_DIR=/data
    volumes:
      - ./data:/data
    ports:
      - "3000:3000"
```

- [ ] **Step 4: Validar a build da imagem (se houver Docker disponível no ambiente)**

Run: `docker build -t promopost-test .`
Expected: build termina com sucesso, sem erro na etapa `npx playwright install --with-deps chromium`.

Se o ambiente onde esta task está sendo executada **não tiver Docker disponível**, pule este step e reporte `DONE_WITH_CONCERNS` explicando que a build não pôde ser validada localmente — a validação real acontece no runbook de deploy no VPS (fora deste plano).

- [ ] **Step 5: Commit**

```bash
git add Dockerfile .dockerignore docker-compose.yml
git commit -m "feat: adiciona Dockerfile e docker-compose para deploy em VPS"
```

---

### Task 9: Scripts de bootstrap, deploy e limpeza de env vars

**Files:**
- Modify: `scripts/bootstrap-session.mjs`
- Modify: `scripts/bootstrap-telegram-session.mjs`
- Create: `deploy.sh`
- Modify: `.env.example`

**Interfaces:**
- Consumes: nenhuma interface de código das tasks anteriores (scripts standalone) — mas escrevem nos mesmos nomes de arquivo que as Tasks 2-6 esperam ler: `ml-session.json`, `telegram-session.txt`.
- Produces: nenhuma interface nova — só os artefatos de runbook (arquivo de sessão local, script de deploy, `.env.example` atualizado) usados no cutover manual (fora deste plano).

- [ ] **Step 1: Reescrever `scripts/bootstrap-session.mjs` pra gravar localmente**

```javascript
#!/usr/bin/env node
// Rodar localmente UMA VEZ (ou sempre que a sessão do Mercado Livre expirar):
//   node scripts/bootstrap-session.mjs
//
// Abre um Chromium visível: logue manualmente no Mercado Livre e navegue até
// o painel de afiliados. Volte ao terminal e aperte ENTER — o script salva a
// sessão (cookies) em ./ml-session.json. Copie esse arquivo pro VPS com
// `scp ml-session.json usuario@vps:/opt/promopost/data/ml-session.json`.

import readline from 'node:readline/promises';
import { writeFile } from 'node:fs/promises';
import { stdin, stdout } from 'node:process';
import { chromium } from 'playwright';

async function main() {
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();

  await page.goto('https://www.mercadolivre.com.br/afiliados/linkbuilder#hub');

  const rl = readline.createInterface({ input: stdin, output: stdout });
  await rl.question(
    '\nLogue no Mercado Livre na janela aberta e navegue até o painel de afiliados.\n' +
      'Quando terminar, volte aqui e aperte ENTER para salvar a sessão...',
  );
  rl.close();

  const storageState = await context.storageState();
  await writeFile('ml-session.json', JSON.stringify(storageState));

  console.log('\nSessão salva em ./ml-session.json.');
  console.log('Copie pro VPS: scp ml-session.json usuario@vps:/opt/promopost/data/ml-session.json');

  await browser.close();
}

main();
```

- [ ] **Step 2: Reescrever `scripts/bootstrap-telegram-session.mjs` pra gravar localmente**

```javascript
#!/usr/bin/env node
// Rodar localmente UMA VEZ (ou sempre que a sessão do Telegram expirar):
//   TELEGRAM_API_ID=xxx TELEGRAM_API_HASH=xxx node scripts/bootstrap-telegram-session.mjs
//
// TELEGRAM_API_ID e TELEGRAM_API_HASH vêm de https://my.telegram.org (Apps).
//
// Loga interativamente (telefone + código SMS + senha de duas etapas, se
// houver) usando a API oficial de cliente do Telegram (GramJS/MTProto) —
// use uma conta secundária dedicada, não sua conta pessoal principal.
// Salva a sessão resultante em ./telegram-session.txt e lista os chats
// (dialogs) da conta pra você identificar o ID do grupo/canal alvo.

import { writeFile } from 'node:fs/promises';
import { TelegramClient } from 'teleproto';
import { StringSession } from 'teleproto/sessions/index.js';
import input from 'input';

async function main() {
  const apiId = Number(process.env.TELEGRAM_API_ID);
  const apiHash = process.env.TELEGRAM_API_HASH;
  if (!apiId || !apiHash) {
    console.error(
      'Defina TELEGRAM_API_ID e TELEGRAM_API_HASH antes de rodar (pegue em https://my.telegram.org).',
    );
    process.exit(1);
  }

  const client = new TelegramClient(new StringSession(''), apiId, apiHash, {
    connectionRetries: 5,
  });

  await client.start({
    phoneNumber: async () =>
      await input.text('Número de telefone (com código do país, ex: +5511999999999): '),
    password: async () =>
      await input.password('Senha de verificação em duas etapas (deixe em branco se não tiver): '),
    phoneCode: async () => await input.text('Código recebido por SMS/Telegram: '),
    onError: (err) => console.error(err),
  });

  const sessionString = client.session.save();
  await writeFile('telegram-session.txt', sessionString);

  console.log('\nSessão salva em ./telegram-session.txt.');
  console.log('Copie pro VPS: scp telegram-session.txt usuario@vps:/opt/promopost/data/telegram-session.txt');

  console.log('\nChats desta conta (pra identificar o ID do grupo/canal alvo):');
  const dialogs = await client.getDialogs({ limit: 50 });
  for (const dialog of dialogs) {
    console.log(`  ${dialog.id} — ${dialog.title ?? dialog.name ?? '(sem título)'}`);
  }
  console.log('\nConfigure no .env do VPS: TELEGRAM_TARGET_CHAT_ID = <ID do chat listado acima>');

  await client.disconnect();
}

main();
```

- [ ] **Step 3: Criar `deploy.sh`**

```bash
#!/usr/bin/env bash
# Rodar no VPS, dentro do diretório do projeto (/opt/promopost):
#   ./deploy.sh
set -euo pipefail
cd "$(dirname "$0")"
git pull
docker compose up -d --build
```

Run: `chmod +x deploy.sh` (garante que o script já suba executável)

- [ ] **Step 4: Atualizar `.env.example`**

Remova as linhas de `BLOB_READ_WRITE_TOKEN`, `ML_SESSION_BLOB_URL` e `TELEGRAM_SESSION_BLOB_URL` (e seus comentários) de `.env.example`, e adicione no topo do arquivo:

```
# Diretório onde os dados persistentes ficam gravados (sessões, cursor,
# tokens, lock). No Docker Compose isso é montado como volume — não precisa
# mudar o valor default a menos que rode fora do container.
DATA_DIR=/data
```

Atualize também o comentário de `WEBHOOK_BASE_URL` (hoje aponta pra `https://promopost.vercel.app`) pro domínio real do VPS assim que definido no runbook de deploy — deixe como está por enquanto (`https://promopost.vercel.app` é só um exemplo no arquivo de referência, não afeta nenhum teste).

- [ ] **Step 5: Rodar a suíte inteira e o typecheck uma última vez**

Run: `npm test && npm run typecheck`
Expected: PASS — nenhum teste depende de `scripts/*.mjs` ou `.env.example` (não têm cobertura automatizada, são scripts operacionais).

- [ ] **Step 6: Commit**

```bash
git add scripts/bootstrap-session.mjs scripts/bootstrap-telegram-session.mjs deploy.sh .env.example
git commit -m "feat: scripts de bootstrap gravam localmente, adiciona deploy.sh pro VPS"
```

---

## Fora deste plano (runbook manual, feito ao vivo)

O restante do spec (`docs/superpowers/specs/2026-08-02-vps-migration-design.md`) não tem tasks de código associadas e é executado manualmente, com orientação passo a passo, depois que este plano estiver mesclado:

- Provisionar o VPS Hostinger (Ubuntu, Docker, ufw), instalar nginx + certbot, apontar o DNS do domínio.
- Copiar as env vars pra um `.env` no VPS e os arquivos `ml-session.json`/`telegram-session.txt` (gerados pelos scripts da Task 9) pro diretório `data/` do VPS.
- Rodar `deploy.sh` pela primeira vez e testar cada rota manualmente (`/api/webhook`, `/api/telegram-poll`, `/api/story-image`, `/api/tiktok-image-proxy`).
- Reconfigurar `TIKTOK_REDIRECT_URI` no TikTok Developer Portal pro novo domínio.
- Adicionar as duas entradas de crontab do host: `*/15 * * * * curl -sf -H "Authorization: Bearer $CRON_SECRET" https://<dominio>/api/telegram-poll` e o backup diário (`tar czf .../backups/$(date +\%F).tar.gz data/`).
- Desligar o cron da Vercel (cron-job.org) só depois de confirmar que tudo funciona no VPS.
