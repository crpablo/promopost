import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadSession } from './sessionStore';

describe('loadSession', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('baixa a sessão da url configurada usando o token como bearer', async () => {
    vi.stubEnv('TELEGRAM_SESSION_BLOB_URL', 'https://blob.vercel-storage.com/telegram-session.txt');
    vi.stubEnv('BLOB_READ_WRITE_TOKEN', 'fake-token');

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => '  1BQANOTE...sessionstring...  \n',
    });
    vi.stubGlobal('fetch', fetchMock);

    const session = await loadSession();

    expect(fetchMock).toHaveBeenCalledWith('https://blob.vercel-storage.com/telegram-session.txt', {
      headers: { authorization: 'Bearer fake-token' },
    });
    expect(session).toBe('1BQANOTE...sessionstring...');
  });

  it('lança erro quando TELEGRAM_SESSION_BLOB_URL não está configurada', async () => {
    vi.stubEnv('TELEGRAM_SESSION_BLOB_URL', '');
    await expect(loadSession()).rejects.toThrow('TELEGRAM_SESSION_BLOB_URL não configurada');
  });

  it('lança erro quando a resposta não é ok', async () => {
    vi.stubEnv('TELEGRAM_SESSION_BLOB_URL', 'https://blob.vercel-storage.com/telegram-session.txt');
    vi.stubEnv('BLOB_READ_WRITE_TOKEN', 'fake-token');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 403 }));

    await expect(loadSession()).rejects.toThrow('Falha ao carregar sessão do Telegram: 403');
  });
});
