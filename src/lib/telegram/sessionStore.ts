import { readTextFile, resolveDataPath } from '../storage/localStore';

const SESSION_FILENAME = 'telegram-session.txt';

export async function loadSession(): Promise<string> {
  const session = await readTextFile(SESSION_FILENAME);
  if (session === null) {
    throw new Error(`Arquivo de sessão do Telegram não encontrado: ${resolveDataPath(SESSION_FILENAME)}`);
  }
  return session;
}
