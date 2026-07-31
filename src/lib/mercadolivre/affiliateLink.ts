import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Sandbox } from '@vercel/sandbox';
import ms from 'ms';
import { InvalidLinkError, ProductNotFoundError, SessionExpiredError } from '../pipeline';
import { loadSession } from '../session/sessionStore';
import type { Product } from '../marketplace/types';

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
      const npmInstall = await sbx.runCommand({
        cmd: 'npm',
        args: ['install', 'playwright'],
        cwd: '/vercel/sandbox',
      });
      if (npmInstall.exitCode !== 0) {
        throw new Error(`Falha ao instalar playwright na sandbox: ${(await npmInstall.stderr()).slice(0, 500)}`);
      }

      const browserInstall = await sbx.runCommand({
        cmd: 'npx',
        args: ['playwright', 'install', 'chromium', 'chromium-headless-shell'],
        cwd: '/vercel/sandbox',
      });
      if (browserInstall.exitCode !== 0) {
        throw new Error(`Falha ao baixar o Chromium na sandbox: ${(await browserInstall.stderr()).slice(0, 500)}`);
      }

      // `playwright install-deps` só suporta apt/Debian — a sandbox roda
      // Amazon Linux (dnf) — então instalamos as libs de sistema do Chromium
      // manualmente. Sem isso o Chromium abre e fecha na hora
      // ("libnspr4.so: cannot open shared object file").
      const depsInstall = await sbx.runCommand({
        cmd: 'dnf',
        args: [
          'install',
          '-y',
          'nss',
          'nspr',
          'atk',
          'cups-libs',
          'libdrm',
          'libxkbcommon',
          'at-spi2-atk',
          'libXcomposite',
          'libXdamage',
          'libXext',
          'libXfixes',
          'libXrandr',
          'mesa-libgbm',
          'pango',
          'cairo',
          'alsa-lib',
          'gtk3',
        ],
        sudo: true,
      });
      if (depsInstall.exitCode !== 0) {
        throw new Error(
          `Falha ao instalar dependências de sistema do Chromium: ${(await depsInstall.stderr()).slice(0, 500)}`,
        );
      }
    },
  });
}

const EMPTY_STORAGE_STATE = Buffer.from(JSON.stringify({ cookies: [], origins: [] }));

export async function fetchProductAndAffiliateLink(productLink: string): Promise<AffiliateResult> {
  // A Shopee não usa sessão logada (a API de afiliados usa credenciais fixas
  // via env var) — carregar a sessão do Mercado Livre não pode ser um
  // pré-requisito rígido pra esse fluxo. Se a sessão do ML não estiver
  // configurada ou o Blob falhar, seguimos com um storageState vazio: o
  // fluxo Mercado Livre continua falhando (com SESSION_EXPIRED, dentro do
  // script, quando o formulário do linkbuilder não aparecer) do jeito que já
  // falhava hoje, e o fluxo Shopee fica inteiramente livre dessa dependência.
  let sessionBuffer: Buffer;
  try {
    sessionBuffer = await loadSession();
  } catch (err) {
    console.warn('Falha ao carregar sessão do Mercado Livre, seguindo com storageState vazio:', err);
    sessionBuffer = EMPTY_STORAGE_STATE;
  }
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
