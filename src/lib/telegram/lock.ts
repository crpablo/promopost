import { del, head, put } from '@vercel/blob';

const LOCK_PATHNAME = 'telegram-poll.lock';

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
  const token = process.env.BLOB_READ_WRITE_TOKEN;

  try {
    const existing = await head(LOCK_PATHNAME, { token });
    const ageMs = Date.now() - existing.uploadedAt.getTime();
    if (ageMs < LOCK_STALE_MS) {
      return false;
    }
  } catch {
    // Sem lock existente (ou erro ao consultar) — segue pra travar.
  }

  await put(LOCK_PATHNAME, String(Date.now()), {
    access: 'private',
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: 'text/plain',
    token,
  });
  return true;
}

export async function releaseLock(): Promise<void> {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  await del(LOCK_PATHNAME, { token }).catch(() => {});
}
