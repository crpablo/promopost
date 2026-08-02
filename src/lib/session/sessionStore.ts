import { readBufferFile, resolveDataPath } from '../storage/localStore';

const SESSION_FILENAME = 'ml-session.json';

export async function loadSession(): Promise<Buffer> {
  const buffer = await readBufferFile(SESSION_FILENAME);
  if (buffer === null) {
    throw new Error(`Arquivo de sessão do Mercado Livre não encontrado: ${resolveDataPath(SESSION_FILENAME)}`);
  }
  return buffer;
}
