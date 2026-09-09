import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { InvalidLinkError, ListCouponError, ProductNotFoundError, SessionExpiredError } from '../pipeline';
import { loadSession } from '../session/sessionStore';
import type { Product } from '../marketplace/types';

export interface AffiliateResult {
  product: Product;
  affiliateLink: string;
}

const SCRIPT_PATH = fileURLToPath(new URL('./generate-link.playwright.mjs', import.meta.url));
const EMPTY_STORAGE_STATE = Buffer.from(JSON.stringify({ cookies: [], origins: [] }));
const EXEC_TIMEOUT_MS = 4 * 60 * 1000;

// Mata o grupo de processos inteiro do script (o `node` filho e qualquer
// processo que ele tenha aberto, inclusive o Chromium do Playwright) — não
// só o processo filho direto. Necessário porque o `node` filho roda
// `spawn(..., { detached: true })`, o que faz dele o líder de um novo grupo
// (pgid == pid); matar com pid negativo mata o grupo inteiro de uma vez.
// Sem isso, um Chromium que não foi fechado corretamente pelo script (ex:
// `chromium.launch()` falha antes do try/finally que fecharia o browser, ou
// o `node` filho é encerrado à força pelo timeout abaixo) fica órfão e
// nunca mais é encerrado — foi o que causou o vazamento de milhares de
// processos `chrome-headless` órfãos, esgotando o limite de processos do
// container em produção (2026-09-09).
function killProcessGroup(pid: number | undefined): void {
  if (!pid) return;
  try {
    process.kill(-pid, 'SIGKILL');
  } catch {
    // Grupo já não existe (processo já tinha encerrado sozinho) — nada a fazer.
  }
}

// Exportada só pra teste direto do comportamento de timeout/kill de grupo
// de processos, sem precisar passar pelo I/O real de sessão/tempdir que
// `fetchProductAndAffiliateLink` faz antes de chegar aqui.
export function runScript(
  productLink: string,
  env: NodeJS.ProcessEnv,
): Promise<{ stdout: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn('node', [SCRIPT_PATH, productLink], { env, detached: true });

    let stdout = '';
    let stderr = '';
    // A promise só pode assentar uma vez — guarda contra o timeout e o
    // 'close' tentarem resolver/rejeitar em sequência (ex: o processo
    // finalmente fecha logo depois do SIGKILL do timeout).
    let settled = false;

    const timer = setTimeout(() => {
      killProcessGroup(child.pid);
      if (settled) return;
      settled = true;
      // Rejeita direto, sem esperar o 'close' — matar o grupo garante que o
      // processo vai morrer, mas não garante que o SO já reaproveitou o pid
      // a tempo; o pipeline não pode ficar preso esperando isso.
      reject(Object.assign(new Error(`Timeout ao gerar link de afiliado (${EXEC_TIMEOUT_MS}ms)`), { stderr }));
    }, EXEC_TIMEOUT_MS);

    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk;
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      killProcessGroup(child.pid);
      if (settled) return;
      settled = true;
      reject(Object.assign(err, { stderr }));
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      killProcessGroup(child.pid);
      if (settled) return;
      settled = true;

      if (code !== 0) {
        reject(Object.assign(new Error('Command failed'), { stderr }));
        return;
      }
      resolve({ stdout });
    });
  });
}

export async function fetchProductAndAffiliateLink(productLink: string): Promise<AffiliateResult> {
  // A Amazon não usa sessão logada (só precisa do Associate Tag via env
  // var) — carregar a sessão do Mercado Livre não pode ser um
  // pré-requisito rígido pra esse fluxo. Se a sessão do ML não estiver
  // configurada, seguimos com um storageState vazio: o fluxo Mercado Livre
  // continua falhando (com SESSION_EXPIRED, dentro do script, quando o
  // formulário do linkbuilder não aparecer) do jeito que já falhava hoje, e
  // o fluxo Amazon fica inteiramente livre dessa dependência.
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
      AMAZON_ASSOCIATE_TAG: process.env.AMAZON_ASSOCIATE_TAG ?? '',
    });
    stdout = result.stdout;
  } catch (err) {
    const stderr = (err as { stderr?: string }).stderr || (err as Error).message || '';
    if (stderr.includes('SESSION_EXPIRED')) {
      throw new SessionExpiredError();
    }
    if (stderr.includes('PRODUCT_NOT_FOUND')) {
      throw new ProductNotFoundError(`Produto não encontrado na página do produto: ${stderr.slice(0, 300)}`);
    }
    if (stderr.includes('MARKETPLACE_NOT_SUPPORTED')) {
      throw new InvalidLinkError(`Link não leva a um marketplace suportado: ${stderr.slice(0, 300)}`);
    }
    if (stderr.includes('AMAZON_CREDENTIALS_MISSING')) {
      throw new Error('Variáveis de ambiente da Amazon ausentes: AMAZON_ASSOCIATE_TAG');
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

  const marketplace = parsed.marketplace === 'amazon' ? 'amazon' : 'mercadolivre';

  return {
    product: { title: parsed.title, price: parsed.price, imageUrl: parsed.imageUrl, marketplace },
    affiliateLink: parsed.affiliateLink,
  };
}
