import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Sandbox } from '@vercel/sandbox';
import ms from 'ms';
import { SessionExpiredError } from '../pipeline';
import { loadSession } from '../session/sessionStore';

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

export async function generateAffiliateLink(productLink: string): Promise<string> {
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
    throw new Error(`Falha ao gerar link de afiliado: ${stderr.slice(0, 500)}`);
  }

  const stdout = (await result.stdout()).trim();
  if (!stdout.startsWith('http')) {
    throw new Error(`Saída inesperada do script de afiliado: ${stdout.slice(0, 200)}`);
  }

  return stdout;
}
