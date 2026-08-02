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
