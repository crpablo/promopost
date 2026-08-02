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
