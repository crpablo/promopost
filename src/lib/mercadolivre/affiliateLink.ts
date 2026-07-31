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
    if (stderr.includes('LINK_NOT_MERCADOLIVRE')) {
      throw new InvalidLinkError(`Link não leva a uma página do Mercado Livre: ${stderr.slice(0, 300)}`);
    }
    if (stderr.includes('PRODUCT_LIST_LINK')) {
      throw new InvalidLinkError(
        `Link aponta pro índice de listas do afiliado, sem produto único associado: ${stderr.slice(0, 300)}`,
      );
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
