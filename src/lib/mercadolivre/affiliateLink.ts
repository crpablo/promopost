import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Sandbox } from '@vercel/sandbox';
import ms from 'ms';
import { ProductNotFoundError, SessionExpiredError } from '../pipeline';
import { loadSession } from '../session/sessionStore';

export interface Product {
  title: string;
  price: number;
  imageUrl: string;
}

export interface AffiliateResult {
  product: Product;
  affiliateLink: string;
}

const SANDBOX_NAME = 'promopost-ml-affiliate';
const SCRIPT_PATH = fileURLToPath(new URL('./generate-link.playwright.mjs', import.meta.url));

async function getSandbox() {
  return Sandbox.getOrCreate({
    name: SANDBOX_NAME,
    runtime: 'node24',
    timeout: ms('4m'),
    onCreate: async (sbx) => {
      await sbx.runCommand({ cmd: 'npm', args: ['install', 'playwright'], cwd: '/vercel/sandbox' });
      await sbx.runCommand({
        cmd: 'npx',
        args: ['playwright', 'install', '--with-deps', 'chromium'],
        cwd: '/vercel/sandbox',
      });
    },
  });
}

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
  });

  if (result.exitCode !== 0) {
    const stderr = await result.stderr();
    if (stderr.includes('SESSION_EXPIRED')) {
      throw new SessionExpiredError();
    }
    if (stderr.includes('PRODUCT_NOT_FOUND')) {
      throw new ProductNotFoundError(`Produto não encontrado na página do Mercado Livre: ${stderr.slice(0, 300)}`);
    }
    throw new Error(`Falha ao gerar link de afiliado: ${stderr.slice(0, 500)}`);
  }

  const stdout = (await result.stdout()).trim();
  let parsed: { title?: unknown; price?: unknown; imageUrl?: unknown; affiliateLink?: unknown };
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

  return {
    product: { title: parsed.title, price: parsed.price, imageUrl: parsed.imageUrl },
    affiliateLink: parsed.affiliateLink,
  };
}
